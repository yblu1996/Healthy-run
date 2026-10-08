// 打印 v15（一缕春风）异常 diagnosis 原文，判断是"截断"还是"围栏/思考块"问题
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: rows } = await supabase
    .from('run_records')
    .select('id, version, status, recognition, diagnosis, user_text, goal, race_date, created_at')
    .eq('id', 'e73e9dc1')
    .limit(5);
  let list = rows || [];
  if (!list.length) {
    const { data: u } = await supabase.from('users').select('id, nickname').eq('nickname', '一缕春风');
    const ids = (u || []).map((x) => x.id);
    console.log('一缕春风 userIds:', ids.join(', '));
    const { data: all } = await supabase
      .from('run_records')
      .select('id, version, status, recognition, diagnosis, user_text, goal, race_date, created_at')
      .in('user_id', ids)
      .order('created_at', { ascending: false })
      .limit(3);
    list = all || [];
  }
  for (const r of list) {
    console.log('=== v' + r.version, r.date || r.created_at, 'status=' + r.status, 'id=' + r.id);
    console.log('goal:', r.goal, 'race_date:', r.race_date);
    console.log('user_text:', String(r.user_text || '').slice(0, 500));
    console.log('recognition:', JSON.stringify(r.recognition).slice(0, 800));
    const d = r.diagnosis;
    console.log('diagnosis typeof:', typeof d, Array.isArray(d) ? '(array)' : '');
    if (typeof d === 'string') {
      fs.writeFileSync(`dev-tests/bad-diagnosis-v${r.version}.txt`, d, 'utf8');
      console.log('长度:', d.length, '→ 已写入 dev-tests/bad-diagnosis-v' + r.version + '.txt');
      console.log('--- 头 600 字 ---\n' + d.slice(0, 600));
      console.log('--- 尾 600 字 ---\n' + d.slice(-600));
      console.log('含 ``` 围栏:', d.includes('```'));
      console.log('含 <think>:', d.includes('<think>'), '含 </think>:', d.includes('</think>'));
      console.log('含 { :', d.indexOf('{'), '含 "summary":', d.indexOf('"summary"'));
      console.log('尾字符:', JSON.stringify(d.slice(-40)));
    }
    console.log('');
  }
})();
