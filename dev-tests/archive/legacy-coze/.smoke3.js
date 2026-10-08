require('dotenv').config({ path: 'C:/Users/Lenovo/WorkBuddy/健康跑程序/.env' });
const { supabase } = require('C:/Users/Lenovo/WorkBuddy/健康跑程序/lib/db');
const fs = require('fs');
const BASE = 'http://localhost:3210';
const out = [];

(async () => {
  try {
    // 注册临时用户
    const reg = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13900000888', password: 'smoke123456', nickname: 'smoke', invite_code: 'SMOKE' }),
    });
    const regData = await reg.json();
    if (!regData.token) { out.push('register failed: ' + JSON.stringify(regData)); return write(); }
    const token = regData.token;
    const uid = regData.user.id;
    out.push('registered uid=' + uid.slice(0, 8));

    // 直接插两条记录：旧的 version=1 但时间在 2 小时前；新的 version=2 时间在现在
    // 若按 version desc 排序，两者顺序恰巧相同（v2 在前），无法区分；靠 created_at 才能验出排序依据
    const twoHrsAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    await supabase.from('run_records').insert([
      { user_id: uid, version: 1, images: [], user_text: '旧记录', goal: 'half_marathon', status: 'done', summary: '旧记录-半马', created_at: twoHrsAgo },
      { user_id: uid, version: 2, images: [], user_text: '新记录', goal: 'full_marathon', status: 'done', summary: '新记录-全马', created_at: new Date().toISOString() },
    ]);

    const list = await fetch(BASE + '/api/records?limit=20', { headers: { Authorization: 'Bearer ' + token } });
    const listData = await list.json();
    out.push('GET /api/records: ' + list.status + ' total=' + listData.total);
    for (const r of (listData.records || [])) {
      out.push(`  ${r.created_at} | v${r.version} | ${r.status} | ${r.goal} | ${r.summary}`);
    }
    const first = (listData.records || [])[0];
    out.push(first && first.summary === '新记录-全马' ? 'SORT OK: newest first' : 'SORT FAIL');
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
  write();
  function write() {
    fs.writeFileSync('C:/Users/Lenovo/WorkBuddy/健康跑程序/.smoke3.out.txt', out.join('\n'), 'utf8');
    console.log('done');
  }
})();
