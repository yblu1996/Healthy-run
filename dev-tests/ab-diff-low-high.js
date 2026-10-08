/**
 * low / high 两档诊断报告差异对比（同一份输入、同一版提示词）
 * 用法：node dev-tests/ab-diff-low-high.js
 */
const fs = require('fs');
const path = require('path');
const { parseModelJson } = require('../lib/model-json');

const IN = JSON.parse(fs.readFileSync(path.join(__dirname, '.ab-input.json'), 'utf8'));

function load(eff) {
  const f = path.join(__dirname, `.ab-${eff}.json`);
  if (!fs.existsSync(f)) return null;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return {
    total: j.total,
    timings: j.timings,
    rec: parseModelJson(j.outputs.recognition),
    diag: parseModelJson(j.outputs.diagnosis_result),
    rawDiagLen: String(j.outputs.diagnosis_result || '').length,
  };
}

const low = load('low');
const high = load('high');
if (!low || !high) { console.error('缺少 .ab-low.json 或 .ab-high.json'); process.exit(1); }

console.log('输入：goal =', IN.goal, '| race_date =', IN.race_date || '(空)', '| 图片', (IN.images || []).length, '张');
console.log('user_text:', String(IN.user_text).replace(/\n/g, ' ').slice(0, 160));
console.log('');

for (const [k, v] of [['low', low], ['high', high]]) {
  console.log(`===== ${k} =====`);
  console.log(`  耗时：识图 ${v.timings.find(t=>t.node==='识图')?.elapsed}s / 诊断计划 ${v.timings.find(t=>t.node==='诊断计划')?.elapsed}s / 全链路 ${v.total?.toFixed(1)}s`);
  console.log(`  诊断原始输出长度：${v.rawDiagLen} 字符（本节点输出 ${v.timings.find(t=>t.node==='诊断计划')?.outLen}B）`);
  const d = v.diag || {};
  console.log(`  字段：${Object.keys(d).join(', ')}`);
  console.log(`  诊断项 ${(d.diagnosis||[]).length} 条 | 周计划 ${(d.plan_8_weeks||[]).length} 周`);
  console.log(`  summary：${String(d.summary||'').slice(0,120)}`);
  const plan = d.plan_8_weeks || [];
  console.log(`  各周跑量：${plan.map(w=>`W${w.week}=${w.weekly_volume_km}`).join(' ')}`);
  console.log(`  各周训练条数：${plan.map(w=>`W${w.week}:${(w.runs||[]).length}`).join(' ')}`);
  const check = plan.map(w => {
    const r = w.runs || [];
    return (r.filter(x=>/全休/.test(String(x.type))).length>=1 ? 1 : 0) + (r.filter(x=>/力量/.test(String(x.type))).length>=2 ? 1 : 0);
  });
  console.log(`  硬要求（每周全休≥1 且 力量≥2）：达标 ${check.filter(c=>c===2).length}/${plan.length} 周`);
  const raw = JSON.stringify(d);
  const missing = ['数据不足','建议补充','缺少','缺失','数据不完整','未提供'].filter(w => raw.includes(w));
  console.log(`  缺失类提示（问题 1 回归）：${missing.length ? '仍出现 → ' + missing.join('、') : '未出现 ✓'}`);
  console.log('');
}

const A = low.diag || {}, B = high.diag || {};
console.log('===== 诊断项逐条对照 =====');
const max = Math.max((A.diagnosis||[]).length, (B.diagnosis||[]).length);
for (let i = 0; i < max; i++) {
  const a = (A.diagnosis||[])[i], b = (B.diagnosis||[])[i];
  console.log(`[${i+1}]`);
  console.log(`  low : ${a ? `${a.issue}（风险 ${a.risk}）` : '—'}`);
  console.log(`        ${a ? String(a.evidence).slice(0,150) : ''}`);
  console.log(`  high: ${b ? `${b.issue}（风险 ${b.risk}）` : '—'}`);
  console.log(`        ${b ? String(b.evidence).slice(0,150) : ''}`);
}
console.log('');
console.log('===== 首周训练逐条对照 =====');
for (const [k, d] of [['low', A], ['high', B]]) {
  const w = (d.plan_8_weeks||[])[0];
  console.log(`[${k}] 第 1 周 focus：${w ? w.focus : '—'}`);
  (w?.runs || []).forEach(r => console.log(`   ${r.day} | ${r.type} | ${String(r.detail).slice(0,80)}`));
}
console.log('');
console.log('===== 备战字段 =====');
for (const [k, d] of [['low', A], ['high', B]]) {
  console.log(`[${k}] goal_feasibility：${String(d.goal_feasibility || '(无)').slice(0,300)}`);
  console.log(`[${k}] race_day_strategy：${String(d.race_day_strategy || '(无)').slice(0,300)}`);
  console.log(`[${k}] progress：${JSON.stringify(d.progress).slice(0,200)}`);
}
