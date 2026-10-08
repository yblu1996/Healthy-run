require('dotenv').config({ path: 'C:/Users/Lenovo/WorkBuddy/健康跑程序/.env' });
const { supabase } = require('C:/Users/Lenovo/WorkBuddy/健康跑程序/lib/db');
const fs = require('fs');

(async () => {
  const out = [];
  try {
    const { data: u } = await supabase.from('users').select('id, phone, nickname, quota').eq('phone', '18853339895').maybeSingle();
    if (!u) { out.push('user not found'); return write(); }
    out.push('user: ' + JSON.stringify(u));

    const { data: recs } = await supabase
      .from('run_records')
      .select('id, version, status, goal, goal_type, created_at, summary')
      .eq('user_id', u.id)
      .order('created_at', { ascending: true });
    out.push('== records by created_at asc ==');
    for (const r of (recs || [])) {
      out.push(`${r.created_at} | v${r.version} | ${r.status} | goal=${r.goal} | type=${r.goal_type} | ${(r.summary || '').slice(0, 26)}`);
    }
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
  write();
  function write() {
    fs.writeFileSync('C:/Users/Lenovo/WorkBuddy/健康跑程序/.chk.out.txt', out.join('\n'), 'utf8');
    console.log('done');
  }
})();
