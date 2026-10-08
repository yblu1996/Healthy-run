// 反馈接口验证：联系方式校验 + 表未建提示
const BASE = 'http://localhost:3000';
const results = [];
const check = (n, p, d) => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${p ? '' : '  << ' + d}`);

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

(async () => {
  await post('/api/auth/register', { phone: '13900000006', password: 'fb-test-2026', security_question: '您最常跑步的地点是哪里', security_answer: 'TestTrack' });
  const login = await post('/api/auth/login', { phone: '13900000006', password: 'fb-test-2026' });
  const token = login.data.token;
  const H = { Authorization: 'Bearer ' + token };

  // 坏联系方式被拒（乱填的字符串）
  let r = await post('/api/feedback', { content: '测试反馈内容一二三四五', contact: '12345' }, H);
  check('bad contact rejected', r.status === 400 && /联系方式/.test(r.data.error), JSON.stringify(r));

  // 非法邮箱被拒
  r = await post('/api/feedback', { content: '测试反馈内容一二三四五', contact: 'abc@' }, H);
  check('bad email rejected', r.status === 400, JSON.stringify(r));

  // 合法手机号通过校验（表未建时给明确指引）
  r = await post('/api/feedback', { content: '测试反馈内容一二三四五', contact: '13800138000' }, H);
  const notInit = r.status === 500 && /初始化|schema/.test(r.data.error || '');
  const ok = r.status === 200;
  check('valid phone accepted (or init-guide error)', ok || notInit, JSON.stringify(r));

  console.log(results.join('\n'));
  console.log(`\n${results.filter(l => l.startsWith('PASS')).length}/${results.length} passed`);
})();
