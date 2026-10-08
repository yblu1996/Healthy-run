require('dotenv').config({ path: 'C:/Users/Lenovo/WorkBuddy/健康跑程序/.env' });
const { supabase } = require('C:/Users/Lenovo/WorkBuddy/健康跑程序/lib/db');
const fs = require('fs');

(async () => {
  const out = [];
  try {
    const { data } = await supabase
      .from('run_records')
      .select('id, images, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    let url = null;
    for (const r of (data || [])) {
      if (Array.isArray(r.images) && r.images.length) { url = r.images[0]; break; }
    }
    if (!url) {
      out.push('no image url found in recent records');
    } else {
      out.push('first image url: ' + url);
      try {
        const res = await fetch(url, { method: 'GET' });
        out.push('GET status: ' + res.status
          + ' | content-type: ' + (res.headers.get('content-type') || '?')
          + ' | content-length: ' + (res.headers.get('content-length') || '?'));
      } catch (e) {
        out.push('GET error: ' + e.message);
      }
    }
  } catch (e) {
    out.push('ERROR: ' + e.message);
  }
  fs.writeFileSync('C:/Users/Lenovo/WorkBuddy/健康跑程序/.imgchk.out.txt', out.join('\n'), 'utf8');
  console.log('done');
})();
