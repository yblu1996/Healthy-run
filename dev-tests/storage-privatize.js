// 图片私有化：把存量 run_records.images 里的公开 URL 改写成对象路径，再把桶设为私有。
//
// 为什么必须改写：库里存的是完整 URL，而公开 URL 在桶转私有后会全部失效。存路径则与桶的
// 公私属性解耦——要看图时按需现签（api/index.js 的 signImagePaths）。
//
// 为什么先改写再翻桶：翻桶是"立即生效"的，先改数据后翻桶，中间态里两边都能用；
// 反过来则有一段窗口，库里的 URL 已经死了、新数据还没按路径写。
//
// 默认只做演练（--dry-run 行为），加 --apply 才真正写库与改桶。
// 用法：node dev-tests/storage-privatize.js            # 演练，只报告
//       node dev-tests/storage-privatize.js --apply    # 真正执行
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');
const BUCKET = process.env.STORAGE_BUCKET || 'run-images';
const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const sb = createClient(BASE, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SIGN_PREFIX = `${BASE}/storage/v1/object/sign/${BUCKET}/`;
const PUBLIC_PREFIX = `${BASE}/storage/v1/object/public/${BUCKET}/`;

// 与 api/index.js 的 imageObjectPath 保持同一套判据（那边是运行时入口，这里是一次性迁移）
function imageObjectPath(input) {
  if (typeof input !== 'string') return null;
  let rest = null;
  if (input.startsWith(SIGN_PREFIX)) rest = input.slice(SIGN_PREFIX.length);
  else if (input.startsWith(PUBLIC_PREFIX)) rest = input.slice(PUBLIC_PREFIX.length);
  else if (/^[\w-]+\/[\w.-]+$/.test(input)) rest = input;
  if (!rest) return null;
  rest = rest.split('?')[0].split('#')[0];
  try { rest = decodeURIComponent(rest); } catch { return null; }
  return /^[\w-]+\/[\w.-]+$/.test(rest) ? rest : null;
}

let ok = 0, bad = 0;
function ck(name, pass, extra) {
  console.log(`${pass ? '[OK]  ' : '[FAIL]'} ${name}${extra ? '   ' + extra : ''}`);
  if (pass) ok += 1; else bad += 1;
}

(async () => {
  console.log(`模式：${APPLY ? '执行（--apply）' : '演练（只报告，不落任何改动）'}\n`);

  // ---------- 1. 存量 images 改写 ----------
  const { data: rows, error } = await sb.from('run_records').select('id, version, images');
  if (error) throw new Error('读取 run_records 失败：' + error.message);

  const changes = [];
  const unmappable = [];
  for (const r of rows || []) {
    const list = Array.isArray(r.images) ? r.images : [];
    const next = [];
    let changed = false;
    for (const u of list) {
      const p = imageObjectPath(u);
      if (!p) { unmappable.push({ id: r.id, v: r.version, u }); next.push(u); continue; }
      next.push(p);
      if (p !== u) changed = true;
    }
    if (changed) changes.push({ id: r.id, version: r.version, images: next, n: list.length });
  }

  console.log(`记录总数：${(rows || []).length}｜需要改写：${changes.length} 条｜无法解析：${unmappable.length} 条`);
  if (unmappable.length) console.log('  无法解析的样例：', JSON.stringify(unmappable.slice(0, 3)));

  if (APPLY) {
    for (const c of changes) {
      const { error: uErr } = await sb.from('run_records').update({ images: c.images }).eq('id', c.id);
      if (uErr) throw new Error(`改写 v${c.version} 失败：${uErr.message}`);
    }
    console.log(`  已改写 ${changes.length} 条`);
  }

  // ---------- 2. 复核：改写后库里应无 public/sign 形态残留 ----------
  const { data: after } = await sb.from('run_records').select('images');
  const all = (after || []).flatMap((r) => (Array.isArray(r.images) ? r.images : []));
  const remain = all.filter((u) => /\/object\/(public|sign)\//.test(u));
  ck('库内图片条目已全部是对象路径', remain.length === 0, `共 ${all.length} 条，残留 URL ${remain.length} 条`);

  // ---------- 3. 存储桶转私有 ----------
  const { data: before } = await sb.storage.getBucket(BUCKET);
  console.log(`\n桶当前 public = ${before && before.public}`);

  if (APPLY) {
    const { data: after_, error: bErr } = await sb.storage.updateBucket(BUCKET, { public: false });
    if (bErr) throw new Error('设置桶为私有失败：' + bErr.message);
    console.log(`桶已设为 public = ${after_.public}`);
  } else {
    console.log('（演练模式，未改桶）');
  }

  // ---------- 4. 验证公私访问行为 ----------
  const { data: top } = await sb.storage.from(BUCKET).list('', { limit: 20 });
  const dir = (top || []).find((d) => !d.id);
  if (dir) {
    const { data: inner } = await sb.storage.from(BUCKET).list(dir.name, { limit: 1 });
    if (inner && inner.length) {
      const target = `${dir.name}/${inner[0].name}`;
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(target);
      const pubRes = await fetch(pub.publicUrl).catch((e) => ({ status: 'ERR' }));
      const { data: sig } = await sb.storage.from(BUCKET).createSignedUrl(target, 60);
      const sigRes = await fetch(sig.signedUrl).catch((e) => ({ status: 'ERR' }));
      console.log(`\n抽样对象：${target.slice(0, 46)}…`);
      console.log(`  公开 URL 取图 -> ${pubRes.status}`);
      console.log(`  签名 URL 取图 -> ${sigRes.status}`);

      const expectPrivate = APPLY;
      ck('私有化后公开 URL 应被拒（400/403）', expectPrivate ? pubRes.status >= 400 : true, 'HTTP ' + pubRes.status);
      ck('私有化后签名 URL 仍可取图', sigRes.status === 200, 'HTTP ' + sigRes.status);
    }
  }

  console.log(`\n=== 断言：${ok} 通过 / ${bad} 失败 ===`);
  if (!APPLY) console.log('提示：当前是演练模式，确认无误后加 --apply 执行');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('执行异常：', e.message); process.exit(1); });
