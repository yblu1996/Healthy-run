require('dotenv').config({ path: 'C:/Users/Lenovo/WorkBuddy/健康跑程序/.env' });
const { supabase } = require('C:/Users/Lenovo/WorkBuddy/健康跑程序/lib/db');
const fs = require('fs');

(async () => {
  const out = [];
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { count: willHit } = await supabase
      .from('run_records')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('created_at', fiveMinAgo);
    out.push('would clean: ' + willHit);

    const { error } = await supabase
      .from('run_records')
      .update({ status: 'failed' })
      .eq('status', 'pending')
      .lt('created_at', fiveMinAgo);
    out.push('update error: ' + (error ? error.message : 'none'));

    const { count: left } = await supabase
      .from('run_records')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    out.push('pending left: ' + left);
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
  fs.writeFileSync('C:/Users/Lenovo/WorkBuddy/健康跑程序/.clean.out.txt', out.join('\n'), 'utf8');
  console.log('done');
})();
