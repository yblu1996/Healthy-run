// 扩展 Dify 工作流的「跑姿/体能指标」采集与分析能力。分两批改动，脚本可重复执行（幂等）。
//
// 批 1（基础扩展）：
//   识图节点 vision_1：metrics 白名单从 8 个基础字段扩到 17 个，补上跑姿与体能进阶字段；
//   顺带修掉一处不一致——规则里要求提取「最快配速」，但 JSON 白名单里没有它的位置，等于白读。
//   诊断节点 diag_1：① 明确「识图给的进阶指标必须作为诊断依据引用」；
//   ② 把「每周至少 1 天全休、力量训练 2 次」从软描述改成逐条自检的硬要求
//   （实测 low / high 两档都只安排了 1 次力量，规则被模型忽略）。
//
// 批 2（顶层 metrics 契约，批 1 实测暴露的问题）：
//   一次上传 10 张图 = 3 次不同日期的跑步时，模型把每次的指标塞进 runs[]，
//   顶层 metrics 只剩「非单次」的周跑量 → 前端报告卡片读不到单次数据。
//   这里把契约写死：metrics 恒等于「日期最新那一次」，runs 只做多次跑步的轻量摘要。
//   同时消歧 weekly_volume_km：App 上的「累计跑量」不是周跑量，别混用
//   （混用会让诊断输出「跑量数据前后不一致」这类假问题）。
//
// 用法：node dev-tests/dify-expand-metrics.js [--dry] [--publish]
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8180';
const APP = 'c19e631c-18e0-428d-bb26-d89fcd71c862';
const H = () => ({
  'Content-Type': 'application/json',
  Cookie: fs.readFileSync(path.join(__dirname, '.dify-cookie.txt'), 'utf8').trim(),
  'X-CSRF-Token': fs.readFileSync(path.join(__dirname, '.dify-csrf.txt'), 'utf8').trim(),
});

// ---------- 识图节点 ----------
const V_OLD_FIELDS = '提取所有图片中出现的字段：单次距离、平均配速、最快配速、平均心率、最大心率、步频、时长、累计跑量、海拔爬升。多张图是同一份训练数据的不同页面，合并成一份指标。没出现的字段一律填 null，绝对不要猜。';
const V1_FIELDS = `提取所有图片中出现的字段。
   基础字段：单次距离、平均配速、最快配速、平均心率、最大心率、步频、时长、累计跑量、海拔爬升。
   进阶字段（跑姿与体能，只有部分 App 或机型会显示，没有就填 null）：平均步幅、触地时间、垂直振幅、左右触地平衡、最大摄氧量、有氧训练压力、无氧训练压力。
   多张图是同一份训练数据的不同页面时，合并成一份指标；同一指标在多张图里都出现时，取数值最完整、最清晰的那次。
   没出现的字段一律填 null，绝对不要猜；进阶字段尤其容易缺失，宁缺勿造。`;
const V2_FIELDS = `提取所有图片中出现的字段。
   基础字段：单次距离、平均配速、最快配速、平均心率、最大心率、步频、时长、近 7 天累计跑量、海拔爬升。
   进阶字段（跑姿与体能，只有部分 App 或机型会显示，没有就填 null）：平均步幅、触地时间、垂直振幅、左右触地平衡、最大摄氧量、有氧训练压力、无氧训练压力。
   metrics 固定填"日期最新那一次跑步"的指标；多个页面属于同一次跑步时合并进这一份，同一指标在多张图里都出现时取最清晰的那次。
   如果截图里是多次不同日期的跑步，在 runs 里按日期从新到旧各列一行摘要；只有一次跑步时 runs 填 []。
   weekly_volume_km 只填 App 明确标注为"本周"或"近 7 天"的跑量；只看到"累计跑量""总里程""本月跑量"时填 null，不要拿累计值充当周跑量。
   没出现的字段一律填 null，绝对不要猜；进阶字段尤其容易缺失，宁缺勿造。`;

const V_OLD_METRICS = `  "metrics": {
    "distance_km": null,
    "avg_pace_min_per_km": null,
    "avg_heart_rate": null,
    "max_heart_rate": null,
    "cadence_spm": null,
    "duration_min": null,
    "weekly_volume_km": null,
    "elevation_gain_m": null
  },`;
const V_NEW_METRICS = `  "metrics": {
    "distance_km": null,
    "avg_pace_min_per_km": null,
    "fastest_pace_min_per_km": null,
    "avg_heart_rate": null,
    "max_heart_rate": null,
    "cadence_spm": null,
    "duration_min": null,
    "weekly_volume_km": null,
    "elevation_gain_m": null,
    "avg_stride_cm": null,
    "ground_contact_time_ms": null,
    "vertical_oscillation_cm": null,
    "ground_balance_left_pct": null,
    "ground_balance_right_pct": null,
    "vo2max": null,
    "aerobic_training_effect": null,
    "anaerobic_training_effect": null
  },`;

// 批 2：metrics 之后补 runs 数组（多次跑步的轻量摘要）
const V_RUNS_BLOCK = `  "runs": [
    { "date": "2026-09-19", "distance_km": null, "avg_pace_min_per_km": null, "avg_heart_rate": null, "cadence_spm": null }
  ],`;

// ---------- 诊断节点 ----------
const D_OLD_RULE4 = '4. 训练安排遵守：周跑量递增不超过上周的 10%、80/20 强度分布（八成轻松跑、两成强度）、每周至少 1 天全休、力量训练每周 2 次。';
const D_NEW_RULE4 = `4. 训练安排的硬性要求（输出前逐条自检，缺任意一条即为不合格）：
   - 周跑量递增不超过上周的 10%；
   - 80/20 强度分布（约八成轻松跑、两成强度课）；
   - 每周 runs 里必须有 1 条 type 为"全休"的训练，detail 写明"全天不跑，保证睡眠"；
   - 每周 runs 里必须有 2 条 type 为"力量"的训练（如"臀中肌 + 核心 20 分钟"），必须拆成 2 条，不得只写 1 条或合并成 1 条。`;

const D_OLD_VISION = `【识图节点输出的识别结果】
{{#vision_1.text#}}`;
const D_NEW_VISION = `【识图节点输出的识别结果】
{{#vision_1.text#}}
（metrics 是日期最新那一次跑步的指标，另有 runs 数组列出多次跑步的摘要。其中除基础字段外，还可能包含跑姿与体能进阶指标：平均步幅、触地时间、垂直振幅、左右触地平衡、最大摄氧量、有氧/无氧训练压力。只要不为 null，就必须作为诊断依据在 diagnosis 的 evidence 里引用，例如触地时间偏长、垂直振幅偏大指向什么；为 null 表示该项数据缺失，不要推测。metrics 里为 null 但 runs 里有的多次跑步数据，可以做趋势判断。）`;

(async () => {
  const dry = process.argv.includes('--dry');
  const draft = await (await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, { headers: H() })).json();
  const changed = [];

  // ---------- 识图节点 ----------
  const vNode = draft.graph.nodes.find((n) => n.id === 'vision_1');
  const vSys = vNode.data.prompt_template.find((p) => p.role === 'system');

  if (vSys.text.includes(V_NEW_METRICS)) {
    console.log('[识图] metrics 白名单已扩展，跳过批 1 的白名单部分');
  } else if (vSys.text.includes(V_OLD_METRICS)) {
    vSys.text = vSys.text.replace(V_OLD_METRICS, V_NEW_METRICS);
    changed.push('识图 metrics 白名单 8 → 17 字段');
  } else {
    throw new Error('[识图] 未找到 metrics 白名单原文，提示词可能已改动');
  }

  if (vSys.text.includes(V2_FIELDS)) {
    console.log('[识图] 规则 1 已是批 2 版本，跳过');
  } else if (vSys.text.includes(V1_FIELDS)) {
    vSys.text = vSys.text.replace(V1_FIELDS, V2_FIELDS);
    changed.push('识图规则 1 改为「metrics=最新一次 + runs 多次摘要」契约');
  } else if (vSys.text.includes(V_OLD_FIELDS)) {
    vSys.text = vSys.text.replace(V_OLD_FIELDS, V2_FIELDS);
    changed.push('识图规则 1 直接升到批 2 版本（含白名单扩展）');
  } else {
    throw new Error('[识图] 未找到规则 1 原文，提示词可能已改动');
  }

  if (vSys.text.includes(V_RUNS_BLOCK)) {
    console.log('[识图] runs 数组已在输出模版里，跳过');
  } else {
    // 用 metrics 最后一个字段作为锚点，比「  },」更稳（后者可能撞上别处的闭合）
    const anchor = '    "anaerobic_training_effect": null\n  },';
    if (!vSys.text.includes(anchor)) throw new Error('[识图] 未找到 metrics 模版尾部，无法插入 runs');
    vSys.text = vSys.text.replace(anchor, anchor + '\n' + V_RUNS_BLOCK);
    changed.push('识图输出模版补 runs 数组');
  }

  // ---------- 诊断节点 ----------
  const dNode = draft.graph.nodes.find((n) => n.id === 'diag_1');
  const dSys = dNode.data.prompt_template.find((p) => p.role === 'system');
  const dUser = dNode.data.prompt_template.find((p) => p.role === 'user');

  if (dSys.text.includes('训练安排的硬性要求')) {
    console.log('[诊断] 规则 4 已是硬要求，跳过');
  } else {
    if (!dSys.text.includes(D_OLD_RULE4)) throw new Error('[诊断] 未找到规则 4 原文，提示词可能已改动');
    dSys.text = dSys.text.replace(D_OLD_RULE4, D_NEW_RULE4);
    changed.push('诊断规则 4 改为逐条自检的硬要求');
  }

  if (dUser.text.includes('runs 数组列出多次跑步的摘要')) {
    console.log('[诊断] user 段已是批 2 版本，跳过');
  } else if (dUser.text.includes(D_OLD_VISION)) {
    dUser.text = dUser.text.replace(D_OLD_VISION, D_NEW_VISION);
    changed.push('诊断 user 段补充进阶指标与 runs 的引用要求');
  } else {
    throw new Error('[诊断] 未找到识图结果段落，提示词可能已改动');
  }

  if (!changed.length) return console.log('两个节点都无需改动。');
  console.log('计划改动：');
  changed.forEach((c) => console.log('  - ' + c));

  if (dry) return console.log('（dry-run，未保存）');

  const put = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, {
    method: 'POST',
    headers: H(),
    body: JSON.stringify({
      graph: draft.graph,
      features: draft.features,
      environment_variables: draft.environment_variables || [],
      conversation_variables: draft.conversation_variables || [],
      rag_pipeline_variables: draft.rag_pipeline_variables || [],
      hash: draft.hash,
    }),
  });
  console.log('保存草稿 →', put.status, (await put.text()).slice(0, 150));
  if (!put.ok) process.exit(1);

  if (process.argv.includes('--publish')) {
    const pub = await fetch(`${BASE}/console/api/apps/${APP}/workflows/publish`, {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ marked_name: '', marked_comment: '' }),
    });
    console.log('发布 →', pub.status, (await pub.text()).slice(0, 150));
  }
})();
