// API 级验证：/api/export/pdf 的 POST 换 URL + GET 回吐（临时 3010 实例上跑）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3010';
const TOKEN = jwt.sign({ id: 'fbda77bb-4eca-405e-adb0-cd25ada55ecc' }, process.env.JWT_SECRET, { expiresIn: '30m' });
let fails = 0;
const check = (n, c, d) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fails++; };

(async () => {
  // 1) 未登录
  const fd1 = new FormData();
  fd1.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'a.pdf');
  const r1 = await fetch(BASE + '/api/export/pdf', { method: 'POST', body: fd1 });
  check('未登录 POST → 401', r1.status === 401, 'got ' + r1.status);

  // 2) 正常上传换 URL
  const content = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n' + 'x'.repeat(1000));
  const fd2 = new FormData();
  fd2.append('file', new Blob([content], { type: 'application/pdf' }), '跑悟AI跑步报告.pdf');
  const r2 = await fetch(BASE + '/api/export/pdf', {
    method: 'POST', body: fd2, headers: { Authorization: 'Bearer ' + TOKEN },
  });
  const j2 = await r2.json();
  check('登录 POST → 200 且带 url', r2.status === 200 && /^\/api\/export\/pdf\/[0-9a-f]{64}\.pdf$/.test(j2.url || ''), JSON.stringify(j2).slice(0, 80));

  // 3) GET 回吐：类型/内容一致
  const r3 = await fetch(BASE + j2.url);
  const buf = Buffer.from(await r3.arrayBuffer());
  check('GET url → 200', r3.status === 200, 'got ' + r3.status);
  check('GET url → Content-Type application/pdf', (r3.headers.get('content-type') || '').includes('application/pdf'), r3.headers.get('content-type'));
  check('GET url → 内容与上传一致', buf.equals(content), `len ${buf.length}`);
  check('GET url → inline 展示', (r3.headers.get('content-disposition') || '').startsWith('inline'), r3.headers.get('content-disposition'));

  // 4) 坏 token / 过期形态
  const r4 = await fetch(BASE + '/api/export/pdf/' + '0'.repeat(64) + '.pdf');
  check('坏 token GET → 404', r4.status === 404, 'got ' + r4.status);

  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
