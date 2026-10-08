// 回归测试 v3：路由分桶限流 + CAS 额度修正后的完整验证
const BASE = 'http://localhost:3000';
const PHONE = '13900000003';
const security = { security_question: '您最常跑步的地点是哪里', security_answer: 'TestTrack' };
const results = [];
const check = (name, pass, detail) => results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : '  << ' + detail}`);

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
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
  // 注册（若已存在则 409，直接登录）
  let r = await post('/api/auth/register', { phone: PHONE, password: 'reg-old-99', ...security });
  const fresh = r.status === 200;
  check('register ok (or exists)', r.status === 200 || r.status === 409, JSON.stringify(r));
  let token;

  r = await post('/api/auth/login', { phone: PHONE, password: 'reg-old-99' });
  check('login ok', r.status === 200 && r.data.token, JSON.stringify(r));
  token = r.data.token;
  const before = (await get('/api/auth/me', { Authorization: 'Bearer ' + token })).data.user.quota;

  // 找回密码：错误答案 403 → 正确答案 200 → 新密码可登录
  r = await post('/api/auth/reset-password', { phone: PHONE, new_password: 'reg-new-88', security_answer: 'WRONG' });
  check('reset wrong answer 403', r.status === 403, JSON.stringify(r));

  r = await post('/api/auth/reset-password', { phone: PHONE, new_password: 'reg-new-88', security_answer: 'testtrack' });
  check('reset ok case-insensitive', r.status === 200, JSON.stringify(r));

  r = await post('/api/auth/login', { phone: PHONE, password: 'reg-new-88' });
  check('login with reset password', r.status === 200, JSON.stringify(r));
  token = r.data.token;

  // 图片 URL 白名单
  r = await post('/api/diagnose', { images: ['https://evil.com/a.jpg'] }, { Authorization: 'Bearer ' + token });
  check('external image url rejected', r.status === 400 && /图片/.test(r.data.error), JSON.stringify(r));

  r = await post('/api/diagnose', { images: [] }, { Authorization: 'Bearer ' + token });
  check('empty images rejected', r.status === 400, JSON.stringify(r));

  // 超过 10 张被拒（全用合法前缀的假 URL，应命中数量校验）
  const fakeUrls = Array.from({ length: 11 }, (_, i) => `x`.padEnd(0));
  r = await post('/api/diagnose', { images: fakeUrls.map(() => 'https://x.supabase.co/storage/v1/object/public/run-images/a.jpg') }, { Authorization: 'Bearer ' + token });
  check('>10 images rejected', r.status === 400, JSON.stringify(r));

  // 模拟支付 + 额度核验（验证 CAS 修正）
  r = await post('/api/pay', {}, { Authorization: 'Bearer ' + token });
  check('mock pay ok', r.status === 200, JSON.stringify(r));
  r = await get('/api/auth/me', { Authorization: 'Bearer ' + token });
  check(`quota ${before} -> ${before + 1}`, r.status === 200 && r.data.user.quota === before + 1, JSON.stringify(r));

  // 限流分桶验证：登录桶打满后，reset 仍可用（路由独立计数）
  for (let i = 0; i < 11; i++) await post('/api/auth/login', { phone: PHONE, password: 'wrong' });
  r = await post('/api/auth/reset-password', { phone: PHONE, new_password: 'reg-new-88', security_answer: 'TestTrack' });
  check('login-throttled but reset unaffected', r.status === 200 || r.status === 403, JSON.stringify(r));
  // 重置为相同密码，不影响后续登录验证

  console.log(results.join('\n'));
  const fails = results.filter((l) => l.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})();
