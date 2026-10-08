// 恢复诊断节点的完整用户提示词（v1 测试时被替换成占位符）
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8180';
const APP = 'c19e631c-18e0-428d-bb26-d89fcd71c862';

const FULL_USER_PROMPT = `【用户描述与填报数据】
{{#start_1.user_text#}}

【跑步目标】{{#start_1.goal#}}（none=只想健康跑，health=提升健康/减脂，half_marathon=半程马拉松，full_marathon=全程马拉松）
【目标比赛日期】{{#start_1.race_date#}}
【历史档案】（JSON，空数组 [] 表示首次诊断）
{{#start_1.history#}}

【识图节点输出的识别结果】
{{#vision_1.text#}}

请按系统要求输出诊断报告与 8 周计划 JSON。`;

(async () => {
  const headers = {
    Cookie: fs.readFileSync(path.join(__dirname, '.dify-cookie.txt'), 'utf8').trim(),
    'X-CSRF-Token': fs.readFileSync(path.join(__dirname, '.dify-csrf.txt'), 'utf8').trim(),
    'Content-Type': 'application/json',
  };
  const r1 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, { headers });
  const draft = await r1.json();
  const diag = draft.graph.nodes.find((n) => n.data.type === 'llm' && n.data.title === '诊断计划');
  const userMsg = diag.data.prompt_template.find((p) => p.role === 'user');
  userMsg.text = FULL_USER_PROMPT;
  console.log('user prompt restored,', FULL_USER_PROMPT.length, 'chars');

  const r2 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, {
    method: 'POST', headers,
    body: JSON.stringify({ graph: draft.graph, features: draft.features, environment_variables: draft.environment_variables || [], conversation_variables: draft.conversation_variables || [], hash: draft.hash }),
  });
  console.log('PUT draft:', r2.status);
  const r3 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/publish`, { method: 'POST', headers, body: '{}' });
  console.log('publish:', r3.status);
})();
