// 一次性回填：把历史记录里"存在库中但无法解析"的 recognition / diagnosis 字符串修补成对象。
// 背景：v15（一缕春风 2026-09-23）报告 status=done，但 diagnosis 是一串带 <think> 的文本，
// 前端因此只能提示"内容不完整"。parseModelJson 能把它还原，这里补回库中。
// 用法：node dev-tests/repair-broken-records.js [--apply]
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { parseModelJson } = require('../lib/model-json');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

(async () => {
  const { data: rows, error } = await supabase
    .from('run_records')
    .select('id, user_id, version, status, summary, recognition, diagnosis, created_at')
    .order('created_at', { ascending: true });
  if (error) return console.error('读取失败：', error.message);

  const broken = (rows || []).filter((r) => !isPlainObject(r.diagnosis) || (r.recognition != null && !isPlainObject(r.recognition)));
  console.log(`共 ${(rows || []).length} 条记录，其中 recognition/diagnosis 非对象的 ${broken.length} 条\n`);
  if (!broken.length) return console.log('无需修补');

  for (const r of broken) {
    const fixed = { ...r };
    const diag = isPlainObject(r.diagnosis) ? r.diagnosis : parseModelJson(r.diagnosis);
    const rec = isPlainObject(r.recognition) ? r.recognition : parseModelJson(r.recognition);

    console.log(`--- v${r.version} ${r.created_at} id=${r.id.slice(0, 8)} status=${r.status}`);
    console.log(`    diagnosis : ${isPlainObject(r.diagnosis) ? '已是对象' : (diag ? `可修补 → ${Array.isArray(diag.plan_8_weeks) ? diag.plan_8_weeks.length + ' 周计划, ' : ''}${Array.isArray(diag.diagnosis) ? diag.diagnosis.length + ' 项诊断' : ''}` : '无法修补')}`);
    console.log(`    recognition: ${r.recognition == null ? '空' : isPlainObject(r.recognition) ? '已是对象' : rec ? '可修补' : '无法修补'}`);

    if (!diag) { console.log('    → 跳过（无法修补，保持原样）\n'); continue; }
    fixed.diagnosis = diag;
    if (rec) fixed.recognition = rec;
    fixed.summary = typeof diag.summary === 'string' && diag.summary ? diag.summary : r.summary;

    if (!APPLY) { console.log('    → [试运行] 待写入\n'); continue; }

    const order = { 高: 3, 中: 2, 低: 1 };
    let top = null;
    for (const it of Array.isArray(diag.diagnosis) ? diag.diagnosis : []) {
      if (it && order[it.risk] && (!top || order[it.risk] > order[top])) top = it.risk;
    }
    const { error: upErr } = await supabase
      .from('run_records')
      .update({ diagnosis: fixed.diagnosis, recognition: fixed.recognition, summary: fixed.summary, status: 'done', risk_level: top })
      .eq('id', r.id);
    console.log(upErr ? `    → 写入失败：${upErr.message}\n` : '    → 已写入\n');
  }
  if (!APPLY) console.log('这是试运行。确认后加 --apply 实际写入。');
})();
