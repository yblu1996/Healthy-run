// A/B 调参：把「识图」「诊断计划」两个节点的思考强度改成 low（可再次运行改回），保存草稿并发布。
// 用法：node dev-tests/dify-apply-reasoning.js low|high [--no-publish]
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8180';
const APP = 'c19e631c-18e0-428d-bb26-d89fcd71c862';
const H = () => ({
  'Content-Type': 'application/json',
  Cookie: fs.readFileSync(path.join(__dirname, '.dify-cookie.txt'), 'utf8').trim(),
  'X-CSRF-Token': fs.readFileSync(path.join(__dirname, '.dify-csrf.txt'), 'utf8').trim(),
});

const effort = process.argv[2];
if (!['low', 'high', 'max'].includes(effort)) {
  console.log('用法：node dev-tests/dify-apply-reasoning.js low|high|max [--no-publish]');
  process.exit(1);
}
const publish = !process.argv.includes('--no-publish');

(async () => {
  const draft = await (await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, { headers: H() })).json();

  for (const id of ['vision_1', 'diag_1']) {
    const n = draft.graph.nodes.find((x) => x.id === id);
    n.data.model.completion_params = { ...n.data.model.completion_params, reasoning_effort: effort };
    console.log(`${id} →`, JSON.stringify(n.data.model.completion_params));
  }

  const put = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, {
    method: 'POST',
    headers: H(),
    body: JSON.stringify({
      graph: draft.graph,
      features: draft.features,
      environment_variables: draft.environment_variables || [],
      conversation_variables: draft.conversation_variables || [],
      rag_pipeline_variables: draft.rag_pipeline_variables || [],
      // 必填：草稿乐观锁，缺失会返回 409 draft_workflow_not_sync
      hash: draft.hash,
    }),
  });
  console.log('保存草稿 →', put.status, (await put.text()).slice(0, 150));
  if (!put.ok) process.exit(1);

  if (publish) {
    const pub = await fetch(`${BASE}/console/api/apps/${APP}/workflows/publish`, {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ marked_name: '', marked_comment: '' }),
    });
    console.log('发布 →', pub.status, (await pub.text()).slice(0, 150));
  }
})();
