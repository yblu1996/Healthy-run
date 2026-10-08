require('dotenv').config();
const { supabase } = require('./lib/db');
const fs = require('fs');

(async () => {
  const out = [];
  try {
    // 所有用户（不输出手机号，只输出昵称与额度）
    const { data: users, error: uerr } = await supabase
      .from('users').select('id, nickname, quota, invite_code').order('created_at', { ascending: true });
    if (uerr) out.push('users error: ' + JSON.stringify(uerr.message));
    if (users) {
      out.push('=== 用户 ' + users.length + ' 个 ===');
      for (const u of users) {
        // 每个用户的记录状态分布
        const { data: recs } = await supabase
          .from('run_records').select('id, status, created_at, summary')
          .eq('user_id', u.id).order('created_at', { ascending: false });
        const cnt = (recs || []).reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
        out.push(`- ${u.nickname || '(无昵称)'}: quota=${u.quota} 记录=${JSON.stringify(cnt)}`);
        // 真水无香展开看明细
        if (u.nickname && u.nickname.includes('真水无香')) {
          out.push('  --- 真水无香 记录明细 ---');
          for (const r of (recs || [])) {
            const t = new Date(r.created_at).toLocaleString('zh-CN', { hour12: false });
            out.push(`  [${r.status}] ${t} summary=${(r.summary || '(空)').slice(0, 40)}`);
          }
        }
      }
    }
  } catch (e) {
    out.push('FATAL: ' + e.message);
  }
  fs.writeFileSync('.diagB.out.txt', out.join('\n'), 'utf8');
  console.log('done');
})();
