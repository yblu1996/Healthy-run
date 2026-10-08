require('dotenv').config({ path: __dirname + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, key);

(async () => {
  const out = [];
  // 最新 3 条诊断记录，看 images 和 recognition
  const { data: recs, error } = await sb
    .from('run_records')
    .select('id, version, status, images, recognition, diagnosis, created_at')
    .order('created_at', { ascending: false })
    .limit(3);
  if (error) { out.push('ERR: ' + JSON.stringify(error)); }
  else {
    for (const r of recs) {
      out.push(`--- v${r.version} ${r.status} ${r.created_at} id=${r.id}`);
      out.push(`images: ${JSON.stringify(r.images)}`);
      const rec = typeof r.recognition === 'string' ? (() => { try { return JSON.parse(r.recognition); } catch (e) { return r.recognition; } })() : r.recognition;
      out.push(`recognition: ${JSON.stringify(rec).slice(0, 800)}`);
    }
  }
  fs.writeFileSync(__dirname + '/.chk2.out.txt', out.join('\n'));
  console.log(out.join('\n'));
})();
