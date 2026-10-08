require('dotenv').config();
const fs = require('fs');

const BASE = 'http://localhost:3210';
const out = [];

async function main() {
  // 1. 页面新元素检查
  const html = await (await fetch(BASE + '/')).text();
  out.push('confirmModal in page: ' + (html.includes('id="confirmModal"') ? 'YES' : 'NO'));
  out.push('btn-danger in page: ' + (html.includes('btn-danger') ? 'YES' : 'NO'));

  // 2. 健康检查
  const h = await (await fetch(BASE + '/api/health')).json();
  out.push('health: ' + JSON.stringify(h));

  // 3. DELETE 路由存在性（无 token 应返回 401 而非 404）
  let delStatus;
  try {
    const r = await fetch(BASE + '/api/records/00000000-0000-0000-0000-000000000000', { method: 'DELETE' });
    delStatus = r.status;
  } catch (e) { delStatus = 'ERR ' + e.message; }
  out.push('DELETE no-auth status: ' + delStatus + ' (401 = 路由存在且正确拒绝)');

  // 4. 注册测试账号（带邀请码）→ 登录 → 删除一条不存在记录（应 404）
  const phone = '1390000' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'test123456', invite_code: 'RUN2026', nickname: '冒烟测试' }),
  });
  out.push('register with invite: ' + reg.status);
  let token = null;
  if (reg.ok) {
    const rj = await reg.json();
    token = rj.token;
  } else {
    // 邀请码不对也能进到这步说明注册被拒，直接报告
    const rj = await reg.json().catch(() => ({}));
    out.push('register body: ' + JSON.stringify(rj));
  }

  if (token) {
    // 删除不存在的记录：带正确 token 应返回 404（证明路由 + 鉴权 + 归属校验都通）
    const dr = await fetch(BASE + '/api/records/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token },
    });
    out.push('DELETE nonexistent with token: ' + dr.status + ' (404 = 正常)');

    // 清理测试账号
    const { supabase } = require('./lib/db');
    await supabase.from('users').delete().eq('phone', phone);
    out.push('test account cleaned');
  }

  fs.writeFileSync('.smoke.out.txt', out.join('\n'), 'utf8');
  console.log('done');
}
main().catch((e) => {
  out.push('FATAL: ' + e.message);
  fs.writeFileSync('.smoke.out.txt', out.join('\n'), 'utf8');
});
