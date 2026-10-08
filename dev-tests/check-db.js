// 检查线上库：run_records 是否有重复 (user_id, version)、feedback 表是否可用
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: rows, error } = await supabase
    .from('run_records')
    .select('id, user_id, version, status, created_at')
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) return console.error('读取失败：', error.message);

  const seen = new Map();
  const dupes = [];
  for (const r of rows || []) {
    const k = r.user_id + '#' + r.version;
    if (seen.has(k)) dupes.push([seen.get(k), r]);
    else seen.set(k, r);
  }
  console.log('总记录数:', (rows || []).length);
  console.log('重复 (user_id, version) 组数:', dupes.length);
  for (const [a, b] of dupes) {
    console.log(`- user ${a.user_id.slice(0, 8)}… v${a.version}: ${a.created_at} / ${b.created_at} (status ${a.status}/${b.status})`);
  }

  const { error: fbErr } = await supabase.from('feedback').select('id').limit(1);
  console.log('feedback 表:', fbErr ? '不存在（需重跑 schema.sql）' : '已存在');
})();
