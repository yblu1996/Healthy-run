require('dotenv').config({ path: 'C:/Users/Lenovo/WorkBuddy/健康跑程序/.env' });
const { supabase } = require('C:/Users/Lenovo/WorkBuddy/健康跑程序/lib/db');
const fs = require('fs');

(async () => {
  const out = [];
  try {
    const { data: u } = await supabase.from('users').select('id').eq('phone', '18853339895').maybeSingle();
    if (!u) { out.push('user not found'); return write(); }
    const uid = u.id;

    const { data: recs } = await supabase
      .from('run_records')
      .select('id, version, status, goal, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });
    out.push('before:');
    for (const r of (recs || [])) out.push(`  ${r.created_at} | v${r.version} | ${r.status} | ${r.goal}`);

    if (!recs || !recs.length) { out.push('no records'); return write(); }

    // 有 unique(user_id, version)：先全部改成负数占位，再从 1 分配
    for (let i = 0; i < recs.length; i++) {
      await supabase.from('run_records').update({ version: -(i + 1) }).eq('id', recs[i].id);
    }
    for (let i = 0; i < recs.length; i++) {
      await supabase.from('run_records').update({ version: i + 1 }).eq('id', recs[i].id);
    }

    const { data: after } = await supabase
      .from('run_records')
      .select('id, version, status, goal, created_at')
      .eq('user_id', uid)
      .order('version', { ascending: true });
    out.push('after:');
    for (const r of (after || [])) out.push(`  ${r.created_at} | v${r.version} | ${r.status} | ${r.goal}`);
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
  write();
  function write() {
    fs.writeFileSync('C:/Users/Lenovo/WorkBuddy/健康跑程序/.fixver.out.txt', out.join('\n'), 'utf8');
    console.log('done');
  }
})();
