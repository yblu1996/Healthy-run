const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const before = await sb.from('users').select('id, phone').like('phone', '139%');
  const lines = ['before count=' + (before.data ? before.data.length : 'err ' + (before.error ? before.error.message : ''))];
  if (before.data) {
    for (const u of before.data) {
      const r = await sb.from('users').delete().eq('id', u.id);
      lines.push('del ' + u.phone + (r.error ? ' ERR ' + r.error.message : ' ok'));
    }
  }
  const after = await sb.from('users').select('id').like('phone', '139%');
  lines.push('after count=' + (after.data ? after.data.length : 'err'));
  fs.writeFileSync(__dirname + '/.reg.clean.txt', lines.join('\n'));
})();
