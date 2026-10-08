// 回归测试：验证加固后的接口行为（跑完即删）
const BASE = 'http://localhost:3000';
const security = { security_question: '您最常跑步的地点是哪里', security_answer: 'TestTrack' };

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

const results = [];
const check = (name, pass, detail) => results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : '  << ' + detail}`);

(async () => {
  // 1. 坏手机号被拒
  let r = await post('/api/auth/register', { phone: 'abc', password: '123456', ...security });
  check('bad phone rejected', r.status === 400 && /手机号/.test(r.data.error), JSON.stringify(r));

  // 2. 短密码被拒
  r = await post('/api/auth/register', { phone: '13800000002', password: '123', ...security });
  check('short password rejected', r.status === 400 && /密码/.test(r.data.error), JSON.stringify(r));

  // 3. 密保答案太短被拒
  r = await post('/api/auth/register', { phone: '13800000002', password: 'pass123456', ...security, security_answer: 'A' });
  check('short security answer rejected', r.status === 400 && /密保答案/.test(r.data.error), JSON.stringify(r));

  // 4. 正常注册成功（带 token）
  r = await post('/api/auth/register', { phone: '13800000002', password: 'pass123456', ...security, nickname: '回归' });
  check('valid register ok', r.status === 200 && r.data.token && r.data.user.quota === 3, JSON.stringify(r));
  const token = r.data.token;

  // 5. 重复注册被拒
  r = await post('/api/auth/register', { phone: '13800000002', password: 'pass123456', ...security });
  check('duplicate register 409', r.status === 409, JSON.stringify(r));

  // 6. 坏 JSON 返回 JSON 错误
  r = await post('/api/auth/login', '{bad json');
  check('malformed json -> json 400', r.status === 400 && r.data && r.data.error, JSON.stringify(r));

  // 7. 登录成功
  r = await post('/api/auth/login', { phone: '13800000002', password: 'pass123456' });
  check('login ok', r.status === 200 && r.data.token, JSON.stringify(r));

  // 8. 找回密码：密保答案错误被拒
  r = await post('/api/auth/reset-password', { phone: '13800000002', new_password: 'newpass123', security_answer: 'WRONG' });
  check('reset wrong answer 403', r.status === 403, JSON.stringify(r));

  // 9. 找回密码：密保答案正确成功（大小写不敏感）
  r = await post('/api/auth/reset-password', { phone: '13800000002', new_password: 'newpass123', security_answer: 'testtrack' });
  check('reset ok (case-insensitive)', r.status === 200, JSON.stringify(r));

  // 10. 新密码可登录
  r = await post('/api/auth/login', { phone: '13800000002', password: 'newpass123' });
  check('login with new password', r.status === 200, JSON.stringify(r));

  // 11. 越权：无 token 访问 records
  r = await get('/api/records');
  check('records without auth 401', r.status === 401, JSON.stringify(r));

  // 12. 带 token 访问 records
  r = await get('/api/records', { Authorization: 'Bearer ' + token });
  check('records with auth 200', r.status === 200 && Array.isArray(r.data.records), JSON.stringify(r));

  // 13. 伪造 token 被拒
  r = await get('/api/records', { Authorization: 'Bearer fake.token.sig' });
  check('forged token 401', r.status === 401, JSON.stringify(r));

  // 14. 未知路径 JSON 404
  r = await get('/api/nothing');
  check('unknown api -> json 404', r.status === 404 && r.data && r.data.error, JSON.stringify(r));

  // 15. diagnose 提交非本站图片 URL 被拒
  r = await post('/api/diagnose', { images: ['https://evil.com/a.jpg'] }, { Authorization: 'Bearer ' + token });
  check('external image url rejected', r.status === 400 && /图片/.test(r.data.error), JSON.stringify(r));

  // 16. diagnose 提交空 images 被拒
  r = await post('/api/diagnose', { images: [] }, { Authorization: 'Bearer ' + token });
  check('empty images rejected', r.status === 400, JSON.stringify(r));

  // 17. pay 原子加次
  r = await post('/api/pay', {}, { Authorization: 'Bearer ' + token });
  check('mock pay ok', r.status === 200, JSON.stringify(r));

  // 18. me 接口验证额度变化
  r = await get('/api/auth/me', { Authorization: 'Bearer ' + token });
  check('quota now 4', r.status === 200 && r.data.user.quota === 4, JSON.stringify(r));

  console.log(results.join('\n'));
  const fails = results.filter((l) => l.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})();
