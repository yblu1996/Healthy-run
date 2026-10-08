// 把诊断节点模型改为 glm-5.3-flash（已验证可用），重新发布
const fs = require('fs');
const BASE = 'http://localhost:8180';
const APP = 'c19e631c-18e0-428d-bb26-d89fcd71c862';

(async () => {
  const headers = {
    Cookie: fs.readFileSync(__dirname + '/.dify-cookie.txt', 'utf8').trim(),
    'X-CSRF-Token': fs.readFileSync(__dirname + '/.dify-csrf.txt', 'utf8').trim(),
    'Content-Type': 'application/json',
  };
  const r1 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, { headers });
  const draft = await r1.json();
  const diag = draft.graph.nodes.find((n) => n.data.type === 'llm' && n.data.title === '诊断计划');
  if (!diag) return console.log('diag node not found');
  console.log('before:', diag.data.model.name, '@', diag.data.model.provider);
  diag.data.model.name = 'glm-5.3-flash';

  const r2 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ graph: draft.graph, features: draft.features, environment_variables: draft.environment_variables || [], conversation_variables: draft.conversation_variables || [], hash: draft.hash }),
  });
  console.log('PUT draft:', r2.status, (await r2.text()).slice(0, 100));
  const r3 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/publish`, { method: 'POST', headers, body: '{}' });
  console.log('publish:', r3.status, (await r3.text()).slice(0, 100));
})();
