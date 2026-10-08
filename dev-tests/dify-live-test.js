// 真实全链路测试：Supabase 历史图片 → Dify 工作流 → 输出解析（生产同款 lib/dify.js）
require('dotenv').config();
const fs = require('fs');
process.env.DIFY_API_KEY = fs.readFileSync(__dirname + '/.dify-appkey.txt', 'utf8').trim();
process.env.DIFY_BASE_URL = 'http://localhost:8180';
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { runWorkflow } = require('../lib/dify');

(async () => {
  const t0 = Date.now();
  const { data: recs } = await supabase
    .from('run_records')
    .select('images, user_text')
    .eq('status', 'done')
    .not('images', 'eq', '[]')
    .order('created_at', { ascending: false })
    .limit(1);
  if (!recs || !recs.length) return console.log('no-record');

  console.log('图片数:', recs[0].images.length, '| 开始调用 Dify 工作流...');
  try {
    const out = await runWorkflow({
      images: recs[0].images,
      userText: recs[0].user_text,
      goal: 'none',
      raceDate: '',
      history: '[]',
    });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const rec = typeof out.recognition === 'string' ? JSON.parse(out.recognition) : out.recognition;
    const dia = typeof out.diagnosis_result === 'string' ? JSON.parse(out.diagnosis_result) : out.diagnosis_result;
    console.log('--- 耗时', secs + 's');
    console.log('识图 image_type:', rec && rec.image_type, '| app:', rec && rec.app_name);
    console.log('识图 metrics:', JSON.stringify(rec && rec.metrics));
    console.log('诊断 summary:', dia && dia.summary);
    console.log('诊断 risk_alert:', dia && dia.risk_alert);
    console.log('问题数:', dia && Array.isArray(dia.diagnosis) ? dia.diagnosis.length : 0,
      '| 风险等级:', dia && Array.isArray(dia.diagnosis) ? dia.diagnosis.map(d => d.risk).join(',') : '-');
    console.log('计划周数:', dia && Array.isArray(dia.plan_8_weeks) ? dia.plan_8_weeks.length : 0,
      '| 第1周跑量:', dia && dia.plan_8_weeks && dia.plan_8_weeks[0] && dia.plan_8_weeks[0].weekly_volume_km);
    fs.writeFileSync(__dirname + '/.dify-live-result.json', JSON.stringify(out, null, 2));
    console.log('FULL-RESULT-SAVED');
  } catch (e) {
    console.error('RUN-FAILED:', e.message);
    process.exit(1);
  }
})();
