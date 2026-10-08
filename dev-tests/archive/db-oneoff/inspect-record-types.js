// 排查「报告数据异常」：检查 run_records 里 recognition / diagnosis 的实际存储类型
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const t = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  const s = String(v);
  return `${typeof v}(${s.length}) ${JSON.stringify(s.slice(0, 120))}`;
};

(async () => {
  const { data: users } = await supabase.from('users').select('id, phone, nickname, quota');
  const byId = new Map((users || []).map((u) => [u.id, u]));
  console.log('用户：');
  for (const u of users || []) {
    console.log(`  ${u.id.slice(0, 8)}… ${u.nickname || ''} ${u.phone || ''} quota=${u.quota}`);
  }

  const { data: rows, error } = await supabase
    .from('run_records')
    .select('id, user_id, version, status, summary, recognition, diagnosis, created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return console.error('读取失败：', error.message);

  console.log('\n最近 30 条记录：');
  for (const r of rows || []) {
    const u = byId.get(r.user_id);
    console.log(`\n--- v${r.version} [${r.status}] ${r.created_at} user=${(u && (u.nickname || u.phone)) || r.user_id.slice(0, 8)} id=${r.id.slice(0, 8)}`);
    console.log('    summary   :', t(r.summary));
    console.log('    recognition:', t(r.recognition));
    console.log('    diagnosis :', t(r.diagnosis));
    if (r.diagnosis && typeof r.diagnosis === 'object' && !Array.isArray(r.diagnosis)) {
      console.log('    diagnosis keys:', Object.keys(r.diagnosis).join(', '));
      console.log('    plan_8_weeks  :', Array.isArray(r.diagnosis.plan_8_weeks) ? r.diagnosis.plan_8_weeks.length + ' 周' : t(r.diagnosis.plan_8_weeks));
      console.log('    diagnosis[]   :', Array.isArray(r.diagnosis.diagnosis) ? r.diagnosis.diagnosis.length + ' 项' : t(r.diagnosis.diagnosis));
    }
    if (typeof r.diagnosis === 'string') {
      try { const p = JSON.parse(r.diagnosis); console.log('    → 可解析，keys:', Object.keys(p).join(', ')); }
      catch { console.log('    → 不是合法 JSON'); }
    }
  }
})();
