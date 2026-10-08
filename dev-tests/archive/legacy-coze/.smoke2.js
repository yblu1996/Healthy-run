// 注册一个临时用户 -> 调 GET /api/records，验证历史页接口（含自动清理逻辑）不崩
const BASE = 'http://localhost:3210';
const fs = require('fs');
const out = [];

(async () => {
  try {
    const reg = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '13900000777',
        password: 'smoke123456',
        nickname: 'smoke',
        invite_code: 'SMOKE',
      }),
    });
    const regData = await reg.json();
    out.push('register: ' + reg.status + (regData.error ? ' ' + regData.error : ' ok'));

    const token = regData.token;
    if (!token) throw new Error('no token from register');
    out.push('token: yes');

    const list = await fetch(BASE + '/api/records?limit=5', {
      headers: { Authorization: 'Bearer ' + token },
    });
    const listData = await list.json();
    out.push('GET /api/records: ' + list.status + ' total=' + (listData.total ?? '?') + (listData.error ? ' err=' + listData.error : ''));
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
  fs.writeFileSync('C:/Users/Lenovo/WorkBuddy/健康跑程序/.smoke2.out.txt', out.join('\n'), 'utf8');
  console.log('done');
})();
