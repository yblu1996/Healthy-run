// Dify 控制台登录：刷新 dev-tests/.dify-cookie.txt 和 .dify-csrf.txt
const fs = require('fs');
const path = require('path');

(async () => {
  const pwd = fs.readFileSync(path.join(__dirname, '.dify-admin-pwd.txt'), 'utf8').trim();
  const r = await fetch('http://localhost:8180/console/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '125316403@qq.com', password: Buffer.from(pwd, 'utf8').toString('base64'), remember_me: true }),
  });
  const d = await r.json();
  if (r.status !== 200 || d.result !== 'success') {
    console.log('login failed:', r.status, JSON.stringify(d).slice(0, 150));
    process.exit(1);
  }
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  let csrf = '';
  const parts = sc.map((c) => c.split(';')[0]);
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k === 'csrf_token') csrf = v;
  }
  fs.writeFileSync(path.join(__dirname, '.dify-cookie.txt'), parts.join('; '));
  fs.writeFileSync(path.join(__dirname, '.dify-csrf.txt'), csrf);
  console.log('login ok, session refreshed');
})();
