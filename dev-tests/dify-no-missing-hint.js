// 问题 1：不同跑步 App 截图能读到的指标本就不一样，原提示词第 2 条要求
// 「信息不足时就写"数据不足，建议补充 XX"」，导致只装了基础数据的用户（华为/Keep 常见）
// 报告里出现一堆"数据缺失"的提示。这里改为：缺项直接跳过、不得提及，只用已有数据分析。
// 用法：node dev-tests/dify-no-missing-hint.js [--dry] [--publish]
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8180';
const APP = 'c19e631c-18e0-428d-bb26-d89fcd71c862';
const H = () => ({
  'Content-Type': 'application/json',
  Cookie: fs.readFileSync(path.join(__dirname, '.dify-cookie.txt'), 'utf8').trim(),
  'X-CSRF-Token': fs.readFileSync(path.join(__dirname, '.dify-csrf.txt'), 'utf8').trim(),
});

const DRY = process.argv.includes('--dry');
const PUBLISH = process.argv.includes('--publish');

// ---- 诊断节点：第 1、2 条原则 ----
const D_OLD_RULE1 = '1. 每一条问题诊断都必须标注依据，说明它来自哪项数据或用户的哪句描述。没有依据的结论不要写。';
const D_NEW_RULE1 = '1. 每一条问题诊断都必须标注依据，说明它来自哪项数据或用户的哪句描述。没有依据的结论不要写（但也不必声明缺了哪项数据，见第 2 条）。';

const D_OLD_RULE2 = '2. 信息不足时就写"数据不足，建议补充 XX"，绝对不要编造数据或下没有支撑的结论。';
const D_NEW_RULE2 = [
  '2. 只依据已有数据做分析。不同 App、不同手表能记录的指标本就不一样：某项数据缺失（例如没有触地时间、没有最大摄氧量、没有最大心率）时，就当它不存在，直接跳过，',
  '   不要提它、不要标注"数据缺失"，绝对不要输出"数据不足""建议补充 XX""缺少 XX 指标""数据不完整"这类提示，也不要因为缺项就自降诊断的结论强度。',
  '   无论拿到多少数据，都必须基于现有数据给出具体、可执行的结论——只有一项数据也能分析。唯一例外：一张图都没识别出有效数据（image_type 为 unclear）时，',
  '   才在 summary 里说明图片无法识别、请重新上传。绝对不要编造数据。',
].join('\n');

// ---- 识图节点：补一句，明确缺项是常态、不构成异常 ----
const V_OLD_RULE1 = '   weekly_volume_km 只填 App 明确标注为"本周"或"近 7 天"的跑量；只看到"累计跑量""总里程""本月跑量"时填 null，不要拿累计值充当周跑量。';
const V_NEW_RULE1 = V_OLD_RULE1 + '\n   部分字段读不到是正常情况（不同 App 展示的指标不同），填 null 即可，不要因此把 image_type 判成 unclear。';

// ---- 诊断节点：补一条 JSON 引号规范 ----
// 实测 low 档一次踩到：模型照抄用户原话写成 "用户自述"前两个月出差中断""，
// 未转义的英文双引号让整串 JSON 报废、报告无法渲染。
const D_ANCHOR_TAIL = '"race_day_strategy": "比赛日配速与补给策略"\n}';
const D_QUOTE_RULE = D_ANCHOR_TAIL + `

输出规范（重要）：JSON 字符串值内部绝对不要出现英文双引号 "。需要引用用户原话时改用中文引号「」；写配速写 5'49 或 5分49秒，不要写 5'49"（这个英寸符号会导致 JSON 解析失败、报告作废）。`;

// ---- 诊断节点：补"正好 8 周"约束 ----
// 稀疏输入实测（只上传 1 张图）时模型输出了 9 周计划，字段叫 plan_8_weeks 却给 9 项。
const D_WEEK_ANCHOR = '   - 每周 runs 里必须有 2 条 type 为"力量"的训练（如"臀中肌 + 核心 20 分钟"），必须拆成 2 条，不得只写 1 条或合并成 1 条。';
const D_WEEK_NEW = D_WEEK_ANCHOR + '\n   - plan_8_weeks 必须正好 8 项（week 依次为 1-8），不要多写第 9 周。';

(async () => {
  const draft = await (await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, { headers: H() })).json();
  if (!draft.graph) throw new Error('草稿读取失败（控制台会话可能已过期，先跑 dify-login.js）');

  const diag = draft.graph.nodes.find((n) => n.id === 'diag_1').data.prompt_template.find((p) => p.id === 'diag-sys');
  const vision = draft.graph.nodes.find((n) => n.id === 'vision_1').data.prompt_template.find((p) => p.id === 'vision-sys');

  const changed = [];

  if (diag.text.includes(D_NEW_RULE2)) {
    console.log('[诊断] 第 2 条已是新版，跳过');
  } else {
    if (!diag.text.includes(D_OLD_RULE1)) throw new Error('[诊断] 未找到原则 1 原文');
    if (!diag.text.includes(D_OLD_RULE2)) throw new Error('[诊断] 未找到原则 2 原文');
    const before = diag.text.length;
    diag.text = diag.text.replace(D_OLD_RULE1, D_NEW_RULE1).replace(D_OLD_RULE2, D_NEW_RULE2);
    changed.push(`诊断原则 1+2 重写：${before} → ${diag.text.length} 字`);
  }

  if (vision.text.includes(V_NEW_RULE1)) {
    console.log('[识图] 缺项说明已存在，跳过');
  } else {
    if (!vision.text.includes(V_OLD_RULE1)) throw new Error('[识图] 未找到 weekly_volume_km 那行原文');
    vision.text = vision.text.replace(V_OLD_RULE1, V_NEW_RULE1);
    changed.push('识图补「部分字段读不到属正常」说明');
  }

  if (diag.text.includes('输出规范（重要）')) {
    console.log('[诊断] JSON 引号规范已存在，跳过');
  } else {
    if (!diag.text.includes(D_ANCHOR_TAIL)) throw new Error('[诊断] 未找到提示词尾部锚点，无法追加引号规范');
    diag.text = diag.text.replace(D_ANCHOR_TAIL, D_QUOTE_RULE);
    changed.push('诊断补「JSON 值内禁用英文双引号」规范');
  }

  if (diag.text.includes('plan_8_weeks 必须正好 8 项')) {
    console.log('[诊断] 8 周约束已存在，跳过');
  } else {
    if (!diag.text.includes(D_WEEK_ANCHOR)) throw new Error('[诊断] 未找到力量训练那行原文，无法追加 8 周约束');
    diag.text = diag.text.replace(D_WEEK_ANCHOR, D_WEEK_NEW);
    changed.push('诊断补「plan_8_weeks 正好 8 项」约束');
  }

  if (!changed.length) return console.log('无改动');

  console.log('改动：');
  changed.forEach((c) => console.log('  - ' + c));
  console.log('\n--- 诊断节点第 2 条新文案 ---\n' + D_NEW_RULE2);

  if (DRY) return console.log('\n[dry] 未保存');

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

  if (PUBLISH) {
    const pub = await fetch(`${BASE}/console/api/apps/${APP}/workflows/publish`, {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ marked_name: '', marked_comment: '' }),
    });
    console.log('发布 →', pub.status, (await pub.text()).slice(0, 150));
  }
})();
