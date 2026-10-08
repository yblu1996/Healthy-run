require('dotenv').config({ path: 'C:/Users/Lenovo/WorkBuddy/健康跑程序/.env' });
const { supabase } = require('C:/Users/Lenovo/WorkBuddy/健康跑程序/lib/db');
const fs = require('fs');

(async () => {
  const out = [];
  try {
    const phones = ['13900000777', '13900000888'];
    const { data: us } = await supabase.from('users').select('id, phone').in('phone', phones);
    out.push('smoke users found: ' + ((us || []).map((u) => u.phone).join(',') || 'none'));
    for (const u of (us || [])) {
      const { count } = await supabase.from('run_records').select('id', { count: 'exact', head: true }).eq('user_id', u.id);
      out.push(`  ${u.phone}: ${count} records`);
      await supabase.from('run_records').delete().eq('user_id', u.id);
      await supabase.from('users').delete().eq('id', u.id);
    }
    const { count: left } = await supabase.from('users').select('id', { count: 'exact', head: true });
    out.push('users left: ' + left);
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
  fs.writeFileSync('C:/Users/Lenovo/WorkBuddy/健康跑程序/.cleanup.out.txt', out.join('\n'), 'utf8');
  console.log('done');
})();
