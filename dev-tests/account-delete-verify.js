// 账号注销 / 数据导出 端到端验证
//
// 用一个临时账号跑完整链路：注册 → 上传图片 → 造一条诊断记录与反馈 → 导出 → 注销 → 逐项断言数据已清干净。
// 断言直连 Supabase（用 .env 里的 service_role），因为"删没删干净"只有查库才说得准。
//
// 为什么不用 /api/diagnose 造数据：那条链路要走 Dify，一次 3 分钟还消耗 AI 额度，
// 而本脚本要验证的是数据面的删除与导出，不涉及模型。直接用记录造夹具即可。
//
// 用法（先在临时端口起一个实例，别动正在跑的 3000）：
//   PORT=3010 node api/index.js
//   node dev-tests/account-delete-verify.js            # 默认打 http://localhost:3010
//   TEST_BASE=http://localhost:3000 node dev-tests/account-delete-verify.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.TEST_BASE || 'http://localhost:3010';
const BUCKET = process.env.STORAGE_BUCKET || 'run-images';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let pass = 0;
let fail = 0;
function ck(name, ok, extra) {
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${extra ? '   ' + extra : ''}`);
  if (ok) pass += 1; else fail += 1;
}

async function api(path, { method = 'POST', body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  return { status: res.status, data };
}

// 最小合法 JPEG：上传接口只按魔数校验（FF D8 FF），不需要真能解码
function tinyJpeg() {
  const head = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const tail = Buffer.from([0xFF, 0xD9]);
  return Buffer.concat([head, Buffer.alloc(64, 0x20), tail]);
}

let uid = null;

(async () => {
  const phone = '1' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  const password = 'Test1234';
  console.log(`目标实例: ${BASE}\n测试手机号: ${phone}\n`);

  try {
    // ---------- 1. 注册临时账号 ----------
    let r = await api('/api/auth/register', {
      body: {
        phone, password, nickname: '注销验证',
        security_question: '我的小学叫什么名字', security_answer: '验证小学',
      },
    });
    ck('注册临时账号', r.status === 200 && !!r.data.token, 'HTTP ' + r.status + ' ' + (r.data.error || ''));
    const token = r.data.token;
    uid = r.data.user && r.data.user.id;
    if (!token || !uid) throw new Error('注册未返回 token/user，后续无法继续');

    // ---------- 2. 未登录时的边界 ----------
    ck('未登录导出被拒(401)', (await api('/api/account/export', { method: 'GET' })).status === 401);
    ck('未登录注销被拒(401)', (await api('/api/account', { method: 'DELETE', body: { password, confirm: '注销' } })).status === 401);

    // ---------- 3. 上传一张图，拿到存储桶地址 ----------
    const fd = new FormData();
    fd.append('images', new Blob([tinyJpeg()], { type: 'image/jpeg' }), 'test.jpg');
    r = await api('/api/upload', { form: fd, token });
    const imgUrl = (r.data.urls || [])[0];
    ck('上传测试图片', r.status === 200 && !!imgUrl, 'HTTP ' + r.status + ' ' + JSON.stringify(r.data).slice(0, 100));

    if (imgUrl) {
      const probe = await fetch(imgUrl);
      ck('（前置）图片确实存在于存储桶', probe.status === 200, 'HTTP ' + probe.status);
    }

    // ---------- 4. 造诊断记录与反馈 ----------
    const ins = await sb.from('run_records').insert({
      user_id: uid,
      version: 1,
      images: imgUrl ? [imgUrl] : [],
      user_text: '注销验证用记录',
      goal: 'none',
      recognition: { image_type: 'training_summary', metrics: { weekly_volume_km: 30 } },
      diagnosis: { summary: '验证用摘要', risk_level: '低', goal_type: 'none', plan_8_weeks: [{ week: 1 }] },
      status: 'done',
      summary: '验证用摘要',
      risk_level: '低',
      goal_type: 'none',
    });
    ck('造一条诊断记录', !ins.error, ins.error ? ins.error.message : '');

    const fb = await sb.from('feedback').insert({ user_id: uid, content: '注销验证用反馈内容' });
    ck('造一条反馈记录', !fb.error, fb.error ? fb.error.message : '');

    // ---------- 5. 导出 ----------
    r = await api('/api/account/export', { method: 'GET', token });
    const blob = JSON.stringify(r.data);
    ck('导出接口返回 200', r.status === 200, 'HTTP ' + r.status + ' ' + (r.data.error || ''));
    ck('导出含账号信息', !!(r.data.account && r.data.account.phone === phone));
    ck('导出含 1 条诊断记录', Array.isArray(r.data.diagnosis_records) && r.data.diagnosis_records.length === 1);
    ck('导出含 1 条反馈', Array.isArray(r.data.feedback) && r.data.feedback.length === 1);
    ck('导出含 8 周计划等完整内容', blob.includes('plan_8_weeks') && blob.includes('weekly_volume_km'));
    ck('导出不含任何哈希字段', !blob.includes('password_hash') && !blob.includes('security_answer_hash'));
    ck('导出不含 bcrypt 哈希串', !/\$2[aby]\$\d\d\$/.test(blob));

    // ---------- 6. 注销的三道校验 ----------
    r = await api('/api/account', { method: 'DELETE', token, body: { password, confirm: '删除' } });
    ck('确认词不对被拒(400)', r.status === 400, r.data.error || '');

    r = await api('/api/account', { method: 'DELETE', token, body: { password: 'WrongPass9', confirm: '注销' } });
    ck('密码错误被拒(403)', r.status === 403, r.data.error || '');

    // 注意 method 必须显式给 GET：api() 默认是 POST，POST /api/auth/me 会落到 404 兜底，
    // 那样这条断言就变成了"恒过"或"恒不过"，测的不是真东西
    r = await api('/api/auth/me', { method: 'GET', token });
    ck('两次失败后账号仍在（未半注销）', r.status === 200, 'HTTP ' + r.status);

    // ---------- 7. 正式注销 ----------
    r = await api('/api/account', { method: 'DELETE', token, body: { password, confirm: '注销' } });
    ck('注销成功', r.status === 200 && r.data.ok === true, JSON.stringify(r.data).slice(0, 140));
    ck('注销清掉了已上传的图片', r.data.removed_images >= 1, 'removed_images=' + r.data.removed_images);

    // ---------- 8. 数据面断言 ----------
    const { data: u } = await sb.from('users').select('id').eq('id', uid).maybeSingle();
    ck('users 行已删除', !u);

    const { data: recs } = await sb.from('run_records').select('id').eq('user_id', uid);
    ck('run_records 已级联清空', !recs || recs.length === 0, '剩 ' + ((recs && recs.length) || 0) + ' 条');

    const { data: fbs } = await sb.from('feedback').select('id').eq('user_id', uid);
    ck('feedback 已显式删除（外键是 set null，不会自动清）', !fbs || fbs.length === 0, '剩 ' + ((fbs && fbs.length) || 0) + ' 条');

    const { data: ords } = await sb.from('orders').select('id').eq('user_id', uid);
    ck('orders 已级联清空', !ords || ords.length === 0);

    if (imgUrl) {
      // Supabase 的公共 URL 走 CDN：文件删掉后 CDN 仍可能命中旧缓存继续返回 200，
      // 所以真实状态必须加查询参数绕过缓存来测（CDN 缓存到期前仍可访问属已知行为）
      const bust = imgUrl + (imgUrl.includes('?') ? '&' : '?') + 'cb=' + Date.now();
      const probe = await fetch(bust);
      ck('存储桶图片已删除（绕过 CDN 缓存查真实状态）', probe.status >= 400, 'HTTP ' + probe.status);
      if (imgUrl) {
        const plain = await fetch(imgUrl);
        console.log(`       （参考）不加缓存参数访问: HTTP ${plain.status}${plain.status === 200 ? ' —— CDN 旧缓存，文件实际已从桶中删除' : ''}`);
      }
    }

    const { data: files } = await sb.storage.from(BUCKET).list(uid);
    ck('存储桶用户目录已空', !files || files.length === 0, '剩 ' + ((files && files.length) || 0) + ' 个文件');

    // ---------- 9. 旧令牌失效 ----------
    r = await api('/api/auth/me', { method: 'GET', token });
    ck('旧令牌已取不到用户(404)', r.status === 404, 'HTTP ' + r.status);
    r = await api('/api/account/export', { method: 'GET', token });
    ck('旧令牌无法再导出(404)', r.status === 404, 'HTTP ' + r.status);
    r = await api('/api/auth/login', { body: { phone, password } });
    ck('原手机号+密码无法再登录', r.status >= 400, 'HTTP ' + r.status);
  } catch (err) {
    ck('脚本执行未抛异常', false, err.message);
  } finally {
    // 兜底清理：中途失败时也别在库里留下测试账号与测试文件
    if (uid) {
      try {
        await sb.from('feedback').delete().eq('user_id', uid);
        await sb.from('users').delete().eq('id', uid);
        const { data: files } = await sb.storage.from(BUCKET).list(uid);
        if (files && files.length) {
          await sb.storage.from(BUCKET).remove(files.map((f) => `${uid}/${f.name}`));
          console.log(`\n（兜底清理：删除残留测试文件 ${files.length} 个）`);
        }
        console.log('（兜底清理：确认测试账号与数据已不存在）');
      } catch (e) {
        console.log('（兜底清理失败，请手工检查 uid=' + uid + '：' + e.message + '）');
      }
    }
    console.log(`\n通过 ${pass} / 失败 ${fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
