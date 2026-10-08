// 存储桶隐私状态探针：查桶属性、存量对象数、以及公开 URL / 签名 URL 两种取图方式的实际表现。
// 只读，不改任何东西。用法：node dev-tests/storage-privacy-probe.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const BUCKET = process.env.STORAGE_BUCKET || 'run-images';
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const sb = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  console.log('桶名：', BUCKET);
  console.log('SUPABASE_URL 主机：', (() => { try { return new URL(URL_).host; } catch { return '(解析失败)'; } })());

  // 1) 桶属性
  const { data: bucket, error: bErr } = await sb.storage.getBucket(BUCKET);
  if (bErr) console.log('查桶失败：', bErr.message);
  else console.log('桶属性：public =', bucket.public, '| file_size_limit =', bucket.file_size_limit, '| allowed_mime_types =', JSON.stringify(bucket.allowed_mime_types));

  // 2) 存量对象：根目录下的用户目录 + 抽查一个对象
  const { data: top, error: lErr } = await sb.storage.from(BUCKET).list('', { limit: 100 });
  if (lErr) console.log('列目录失败：', lErr.message);
  else {
    const dirs = (top || []).filter((f) => !f.id); // 目录没有 id
    const files = (top || []).filter((f) => f.id);
    console.log('根目录条目：目录', dirs.length, '个 / 文件', files.length, '个');

    let total = 0, sample = null;
    for (const d of dirs.slice(0, 50)) {
      const { data: inner } = await sb.storage.from(BUCKET).list(d.name, { limit: 1000 });
      total += (inner || []).length;
      if (!sample && inner && inner.length) sample = `${d.name}/${inner[0].name}`;
    }
    console.log('存量图片总数（前 50 个目录统计）：', total);

    if (sample) {
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(sample);
      const r1 = await fetch(pub.publicUrl).catch((e) => ({ status: 'ERR ' + e.message }));
      console.log('样例对象：', sample);
      console.log('  公开 URL 取图 ->', r1.status);

      const { data: sig, error: sErr } = await sb.storage.from(BUCKET).createSignedUrl(sample, 60);
      if (sErr) console.log('  签发失败：', sErr.message);
      else {
        const r2 = await fetch(sig.signedUrl).catch((e) => ({ status: 'ERR ' + e.message }));
        console.log('  签名 URL 取图 ->', r2.status);
        console.log('  签名 URL 形态：', sig.signedUrl.replace(/\?.*$/, '?<token>'));
      }
    } else {
      console.log('（桶里暂无图片）');
    }
  }

  // 3) run_records.images 存量形态
  const { data: rows, error: rErr } = await sb.from('run_records').select('id, images').limit(100);
  if (rErr) console.log('查 run_records 失败：', rErr.message);
  else {
    const all = (rows || []).flatMap((r) => (Array.isArray(r.images) ? r.images : []));
    const kinds = {};
    for (const u of all) {
      const k = /\/object\/sign\//.test(u) ? '签名URL' : /\/object\/public\//.test(u) ? '公开URL' : /^[\w-]+\//.test(u) ? '裸路径' : '其它';
      kinds[k] = (kinds[k] || 0) + 1;
    }
    console.log('run_records 行数：', (rows || []).length, '| images 条目合计：', all.length, '| 形态分布：', JSON.stringify(kinds));
    if (all[0]) console.log('样例：', String(all[0]).replace(/\?.*$/, '?<token>'));
  }
})().catch((e) => { console.error('探针异常：', e.message); process.exit(1); });
