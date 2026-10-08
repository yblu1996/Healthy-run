// 对比 .ab-<档位>.json 三档输出的质量指标（与 dify-ab-matrix.js 的耗时实测配套）
// 真值来自本次 10 张原始截图（9/23 详情页）：distance 7.41km / 43:03 / 5'49" / HR 150-163 / 步频 193 / 爬升 7.3m
const fs = require('fs');
const path = require('path');
const { parseModelJson } = require('../lib/model-json');

const TRUTH = {
  distance_km: 7.41,
  duration_min: 43.05,
  avg_pace_min_per_km: '5\'49"',
  avg_heart_rate: 150,
  max_heart_rate: 163,
  cadence_spm: 193,
  elevation_gain_m: 7.3,
  weekly_volume_km: 42,
};

const thinkLen = (s) => {
  let n = 0, m;
  const re = /<think>[\s\S]*?<\/think>/gi;
  while ((m = re.exec(s))) n += m[0].length;
  if (!n && /<think>/i.test(s)) n = s.length;
  return n;
};

for (const eff of ['low', 'high', 'max']) {
  const f = path.join(__dirname, `.ab-${eff}.json`);
  if (!fs.existsSync(f)) { console.log(`\n===== ${eff} 未测 =====`); continue; }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const rawRec = String(j.outputs.recognition || '');
  const rawDiag = String(j.outputs.diagnosis_result || '');
  const rec = parseModelJson(rawRec);
  const d = parseModelJson(rawDiag);

  console.log(`\n===== ${eff} （全链路 ${Number(j.total).toFixed(0)}s）=====`);
  console.log(`原始输出：识图 ${rawRec.length} 字符（其中思考块 ${thinkLen(rawRec)}）| 诊断 ${rawDiag.length} 字符（其中思考块 ${thinkLen(rawDiag)}）`);

  if (rec) {
    const m = rec.metrics || {};
    const wrong = Object.keys(TRUTH).filter((k) => String(m[k]) !== String(TRUTH[k]));
    console.log(`识图 metrics：${Object.keys(m).length} 个字段，与真值一致 ${Object.keys(TRUTH).length - wrong.length}/${Object.keys(TRUTH).length}`);
    console.log(`  值：${JSON.stringify(m)}`);
    console.log(`  漏/错：${wrong.length ? wrong.map((k) => `${k}(真值 ${TRUTH[k]})`).join(', ') : '无'}`);
    console.log(`  跑姿观察：${Array.isArray(rec.form_observations) ? rec.form_observations.length : '-'} 条 | image_type=${rec.image_type}`);
  } else {
    console.log('识图：解析失败');
  }

  if (d) {
    const items = d.diagnosis || [];
    const weeks = d.plan_8_weeks || [];
    const noEv = items.filter((x) => !x.evidence || String(x.evidence).length <= 5).length;
    console.log(`诊断：字段 ${Object.keys(d).length} 个 | 诊断项 ${items.length} | 8 周计划 ${weeks.length} 周 | 每周训练条数 ${weeks.map((w) => (w.runs || []).length).join(',')}`);
    console.log(`  keys：${Object.keys(d).join(', ')}`);
    console.log(`  依据缺失条数：${noEv} | summary ${String(d.summary || '').length} 字 | risk_alert=${JSON.stringify(d.risk_alert)}`);
    console.log(`  诊断项：${items.map((x) => `${x.issue}[${x.risk}]`).join(' / ')}`);
  } else {
    console.log('诊断：解析失败');
  }
}
