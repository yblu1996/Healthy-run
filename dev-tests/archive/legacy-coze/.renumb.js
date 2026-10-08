require('dotenv').config();
const fs = require('fs');
const BASE = 'http://localhost:3210';
const { supabase } = require('./lib/db');
const out = [];

async function main() {
  // 注册测试号
  const phone = '138' + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password: 'test123456', invite_code: 'RUN2026', nickname: '重编号测试' }),
  });
  if (!reg.ok) { out.push('register failed: ' + reg.status); fs.writeFileSync('.renumb.out.txt', out.join('\n')); return; }
  const { token } = await reg.json();
  const auth = { Authorization: 'Bearer ' + token };

  // 拿 user_id
  const { data: u } = await supabase.from('users').select('id').eq('phone', phone).single();

  // 直接插 3 条记录（version 1/2/3，模拟做过 3 次诊断）
  for (let v = 1; v <= 3; v++) {
    await supabase.from('run_records').insert({
      user_id: u.id, version: v, status: 'done',
      summary: '测试记录' + v, goal: 'none',
    });
  }
  const before = await supabase.from('run_records').select('id, version').eq('user_id', u.id).order('version');
  out.push('删除前: ' + before.data.map((r) => 'v' + r.version).join(','));

  // 删第 1 条
  const delId = before.data.find((r) => r.version === 1).id;
  const dr = await fetch(BASE + '/api/records/' + delId, { method: 'DELETE', headers: auth });
  out.push('DELETE status: ' + dr.status);

  const after = await supabase.from('run_records').select('version, summary').eq('user_id', u.id).order('version');
  out.push('删除后: ' + after.data.map((r) => 'v' + r.version + '(' + r.summary + ')').join(','));
  const versions = after.data.map((r) => r.version);
  const ok = versions.length === 2 && versions[0] === 1 && versions[1] === 2;
  out.push(ok ? 'PASS: 剩余记录已从 1 连续重编号' : 'FAIL: 重编号不正确');

  // 清理测试号
  await supabase.from('run_records').delete().eq('user_id', u.id);
  await supabase.from('users').delete().eq('phone', phone);
  out.push('test account cleaned');

  fs.writeFileSync('.renumb.out.txt', out.join('\n'), 'utf8');
}
main().catch((e) => { out.push('FATAL: ' + e.message); fs.writeFileSync('.renumb.out.txt', out.join('\n'), 'utf8'); });
