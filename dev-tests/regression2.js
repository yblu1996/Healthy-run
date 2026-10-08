// 回归测试第二部分：限流敏感用例（每类请求间隔足够大，避免触发限流）
const BASE = 'http://localhost:3000';
const results = [];
const check = (name, pass, detail) => results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : '  << ' + detail}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
async function get(path, headers = {}) {
  const res = await fetch(BASE + path, { headers });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  // 登录拿 token（等限流窗口清零后跑）
  await sleep(1000);
  let r = await post('/api/auth/login', { phone: '13800000002', password: 'newpass123' });
  if (r.status !== 200) {
    // 第一次脚本没跑完重置，密码还是 pass123456
    r = await post('/api/auth/login', { phone: '13800000002', password: 'pass123456' });
  }
  check('login ok', r.status === 200, JSON.stringify(r));
  const token = r.data.token;
  await sleep(1000);

  // 找回密码：密保答案错误 403
  r = await post('/api/auth/reset-password', { phone: '13800000002', new_password: 'newpass123', security_answer: 'WRONG' });
  check('reset wrong answer 403', r.status === 403, JSON.stringify(r));
  await sleep(21000);

  // 找回密码：正确密保答案（大小写不敏感）+ 新密码
  r = await post('/api/auth/reset-password', { phone: '13800000002', new_password: 'reset-ok-99', security_answer: 'testtrack' });
  check('reset ok case-insensitive', r.status === 200, JSON.stringify(r));
  await sleep(21000);

  // 新密码登录
  r = await post('/api/auth/login', { phone: '13800000002', password: 'reset-ok-99' });
  check('login with reset password', r.status === 200, JSON.stringify(r));
  await sleep(1000);

  // diagnose 外站图片 URL 拒绝
  r = await post('/api/diagnose', { images: ['https://evil.com/a.jpg'] }, { Authorization: 'Bearer ' + token });
  check('external image url rejected', r.status === 400 && /图片/.test(r.data.error), JSON.stringify(r));
  await sleep(13000);

  // diagnose 空 images 拒绝
  r = await post('/api/diagnose', { images: [] }, { Authorization: 'Bearer ' + token });
  check('empty images rejected', r.status === 400, JSON.stringify(r));
  await sleep(13000);

  // 模拟支付 + 额度核验
  r = await post('/api/pay', {}, { Authorization: 'Bearer ' + token });
  check('mock pay ok', r.status === 200, JSON.stringify(r));
  await sleep(1000);
  r = await get('/api/auth/me', { Authorization: 'Bearer ' + token });
  check('quota incremented', r.status === 200 && r.data.user.quota === 4, JSON.stringify(r));

  console.log(results.join('\n'));
  const fails = results.filter((l) => l.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})();
