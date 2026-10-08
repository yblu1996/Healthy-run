const BASE = 'http://localhost:3210';
const out = [];
const phone = '13900000' + Math.floor(Math.random() * 1000);
const code = 'RUN_5480O';

(async () => {
  // 1. 模拟"没带邀请码"的注册（旧前端的实际行为）
  try {
    const res = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: '123456' }),
    });
    const d = await res.json();
    out.push('不带邀请码: status=' + res.status + ' error=' + (d.error || '无'));
  } catch (e) {
    out.push('不带邀请码 THREW ' + e.message);
  }

  // 2. 模拟"带邀请码"的注册（修复后的行为）
  try {
    const res = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '139' + phone.slice(3), password: '123456', invite_code: code }),
    });
    const d = await res.json();
    out.push('带邀请码: status=' + res.status + ' quota=' + (d.user ? d.user.quota : '无user') + ' token=' + (d.token ? '有' : '无'));
  } catch (e) {
    out.push('带邀请码 THREW ' + e.message);
  }

  const fs = require('fs');
  fs.writeFileSync(__dirname + '/.reg.out.txt', out.join('\n'));
})();
