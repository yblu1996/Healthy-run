// 图片私有化 + 年龄门槛 端到端验证
//
// 造一个临时账号走真实链路：注册 → 登录 → 上传 → 预览取图 → 提交诊断（真跑 Dify）→ 查库断言。
// 跑完自动把测试账号注销掉，不留垃圾数据。
//
// 用法（先在临时端口起实例，别动正在跑的 3000）：
//   PORT=3010 node api/index.js
//   node dev-tests/image-privacy-verify.js                 # 全量（含一次真实诊断，约 3 分钟）
//   node dev-tests/image-privacy-verify.js --skip-diagnose # 跳过诊断（翻桶后的快速复查用）
//   TEST_BASE=http://localhost:3000 node dev-tests/image-privacy-verify.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.TEST_BASE || 'http://localhost:3010';
const BUCKET = process.env.STORAGE_BUCKET || 'run-images';
const SKIP_DIAG = process.argv.includes('--skip-diagnose');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 测试素材：一张真实的跑步 App 截图。本地没有就现签一张下来（桶已私有，不能再取公开地址），
// 这样脚本自愈，也避免把用户图片作为二进制长期放在仓库里。
const FIXTURE = path.join(__dirname, '.fixtures', 'run-data-sample.jpg');
const FIXTURE_OBJECT = 'fbda77bb-4eca-405e-adb0-cd25ada55ecc/1790169373816-736dcf8e-dece-4f69-8445-fb7fc886db2b.jpg';

async function loadFixture() {
  if (fs.existsSync(FIXTURE)) return fs.readFileSync(FIXTURE);
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(FIXTURE_OBJECT, 300);
  if (!data || !data.signedUrl) throw new Error('无法为测试素材签发链接：' + FIXTURE_OBJECT);
  const r = await fetch(data.signedUrl);
  if (r.status !== 200) throw new Error(`下载测试素材失败 HTTP ${r.status}（对象是否还在桶里？${FIXTURE_OBJECT}）`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  fs.writeFileSync(FIXTURE, buf);
  return buf;
}
// 库里已存在的另一个用户目录，用来验证"能不能引用别人的图"
const OTHER_USER_DIR = 'fbda77bb-4eca-405e-adb0-cd25ada55ecc';

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${extra ? '   ' + extra : ''}`);
  if (ok) pass += 1; else fail += 1;
}

// 登录态存模块级：api() 默认带上，避免每次调用都要记得传 token
// （踩过：漏传一次 token，诊断被 401 挡下，却看起来像"后端坏了"）
let authToken = null;
async function api(p, { method = 'POST', body, token = authToken, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + p, { method, headers, body: payload });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

let uid = null, token = null;

(async () => {
  const img = await loadFixture();

  const phone = '1' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  const password = 'Test1234';
  console.log(`目标实例: ${BASE}\n测试手机号: ${phone}\n诊断环节: ${SKIP_DIAG ? '跳过' : '执行（约 3 分钟）'}\n`);

  try {
    // ---------- 1. 登录链路（私有化会不会影响登录，就是看这一段） ----------
    let r = await api('/api/auth/register', {
      body: { phone, password, nickname: '隐私验证', security_question: '我的小学叫什么名字', security_answer: '验证小学' },
    });
    ck('注册成功', r.status === 200 && !!r.data.token, 'HTTP ' + r.status + ' ' + (r.data.error || ''));
    uid = r.data.user && r.data.user.id;
    token = r.data.token;
    authToken = token; // 让后续所有 api() 调用默认带上登录态
    if (!token || !uid) throw new Error('注册未返回 token/user，后续无法继续');

    r = await api('/api/auth/me', { method: 'GET', token });
    ck('登录态可用 /auth/me', r.status === 200 && r.data.user && r.data.user.id === uid, 'HTTP ' + r.status);

    r = await api('/api/auth/login', { body: { phone, password } });
    ck('重新登录成功（与存储桶公私无关）', r.status === 200 && !!r.data.token, 'HTTP ' + r.status + ' ' + (r.data.error || ''));

    // ---------- 2. 上传：必须返回签名 URL，而不是永久公开 URL ----------
    const fd = new FormData();
    fd.append('images', new Blob([img], { type: 'image/jpeg' }), 'run-data.jpg');
    r = await api('/api/upload', { form: fd, token });
    const urls = r.data.urls || [];
    ck('上传成功', r.status === 200 && urls.length === 1, 'HTTP ' + r.status + ' ' + (r.data.error || ''));
    const upUrl = urls[0] || '';
    ck('返回的是签名 URL（含 /object/sign/）', /\/object\/sign\//.test(upUrl), upUrl.replace(/\?.*$/, '?<token>').slice(0, 96) + '…');
    ck('不再返回永久公开 URL（不含 /object/public/）', !/\/object\/public\//.test(upUrl));

    if (upUrl) {
      const probe = await fetch(upUrl).catch(() => ({ status: 'ERR' }));
      ck('前端预览能用签名 URL 取到图', probe.status === 200, 'HTTP ' + probe.status);
    }

    // ---------- 3. 年龄门槛（前端 min=14，后端必须兜底） ----------
    // 注意：/api/diagnose 限流 5 次/分钟，这里的探针请求 + 后续真实诊断必须控制在 5 次以内
    const base = { user_text: '验证', goal: 'none', race_date: '', gender: '男', height: 175, weight: 70, weekly_volume: 30, avg_hr: 145, images: urls };
    r = await api('/api/diagnose', { body: { ...base, age: 12 }, token });
    ck('年龄 12 岁被后端拒绝(400)', r.status === 400 && /年龄/.test(r.data.error || ''), 'HTTP ' + r.status + ' ' + (r.data.error || ''));

    // ---------- 4. 图片归属：不能引用别人的图 ----------
    const otherPub = `${(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/${OTHER_USER_DIR}/whatever.jpg`;
    r = await api('/api/diagnose', { body: { ...base, age: 40, images: [otherPub] }, token });
    ck('引用他人目录的图片被拒(400)', r.status === 400, 'HTTP ' + r.status + ' ' + (r.data.error || ''));
    r = await api('/api/diagnose', { body: { ...base, age: 40, images: [`${uid}/../../etc/passwd`] }, token });
    ck('路径穿越被拒(400)', r.status === 400, 'HTTP ' + r.status);

    if (SKIP_DIAG) {
      console.log('\n（已跳过诊断环节）');
    } else {
      // ---------- 5. 真实诊断：Dify 必须能通过签名 URL 拉到图 ----------
      console.log('\n提交真实诊断（Dify 全链路，约 3 分钟）…');
      const t0 = Date.now();
      r = await api('/api/diagnose', {
        body: { ...base, age: 40, user_text: '', goal: 'half', race_date: '' },
      });
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      ck('诊断全链路成功', r.status === 200 && !!r.data.record_id, `HTTP ${r.status}｜${secs}s｜${r.data.error || ''}`);

      const recog = r.data.recognition || {};
      ck('识图拿到了图片（image_type 非 unclear）', !!recog.image_type && recog.image_type !== 'unclear',
        'image_type=' + recog.image_type);
      // 判据必须是 image_type 而不是"指标条数"：拉取失败时会是 unclear，而单图/总览类截图
      // 本来就可能 17 个指标全空（实测同一张图在公开 URL 与签名 URL 下都是 0 项），条数为 0 不等于没读到图
      const metrics = recog.metrics || {};
      const nonNull = Object.values(metrics).filter((v) => v !== null && v !== undefined && v !== '');
      console.log(`      └ 非空指标 ${nonNull.length} 项（参考值，不作判据）`);

      const diag = r.data.result && r.data.result.diagnosis_result;
      const blob = JSON.stringify(diag || '');
      for (const w of ['数据不足', '建议补充', '数据缺失', '数据不完整']) {
        ck(`报告未出现「${w}」`, !blob.includes(w));
      }
      ck('8 周计划为 8 项', Array.isArray(diag && diag.plan_8_weeks) && diag.plan_8_weeks.length === 8,
        '实际 ' + ((diag && diag.plan_8_weeks) || []).length + ' 项');
    }

    // ---------- 6. 落库形态：必须是路径，不是 URL ----------
    // 跳过诊断时没有 run_records 可查，这两条一并跳过（否则会报"没有记录"的假失败）
    if (!SKIP_DIAG) {
      const { data: rows } = await sb.from('run_records').select('id, images, status').eq('user_id', uid);
      const stored = (rows || []).flatMap((x) => (Array.isArray(x.images) ? x.images : []));
      ck('run_records.images 存的是对象路径', stored.length > 0 && stored.every((s) => /^[\w-]+\/[\w.-]+$/.test(s)),
        '样例 ' + String(stored[0] || '').slice(0, 60));
      ck('路径前缀是本人 user_id', stored.length > 0 && stored.every((s) => s.startsWith(uid + '/')));
    }

    // ---------- 7. 桶里确实有对象 ----------
    const { data: objs } = await sb.storage.from(BUCKET).list(uid, { limit: 100 });
    ck('存储桶本人目录下有图片', (objs || []).length > 0, (objs || []).length + ' 个对象');

    // ---------- 8. 清理：注销测试账号 ----------
    r = await api('/api/account', { method: 'DELETE', body: { password, confirm: '注销' }, token });
    ck('测试账号已注销（不留垃圾数据）', r.status === 200, 'HTTP ' + r.status + ' ' + (r.data.error || ''));
    const { data: left } = await sb.from('run_records').select('id').eq('user_id', uid);
    ck('注销后记录已清空', (left || []).length === 0);
    const { data: objsAfter } = await sb.storage.from(BUCKET).list(uid, { limit: 100 });
    ck('注销后图片已清空', (objsAfter || []).length === 0);
    uid = null;
  } catch (e) {
    console.error('\n执行异常：', e.message);
    fail += 1;
  } finally {
    if (uid) {
      try {
        await api('/api/account', { method: 'DELETE', body: { password, confirm: '注销' }, token });
        console.log('\n（已尽力清理测试账号）');
      } catch { /* 清理失败不影响结论 */ }
    }
  }

  console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})();
