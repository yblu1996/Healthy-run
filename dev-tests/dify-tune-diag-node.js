// 调整 Dify「诊断计划」节点的模型参数（思考强度 / 回复格式），并可选择发布。
// 用法：
//   node dev-tests/dify-tune-diag-node.js --show
//   node dev-tests/dify-tune-diag-node.js --set '{"reasoning_effort":"low","response_format":"json_object"}' [--publish]
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8180';
const APP = 'c19e631c-18e0-428d-bb26-d89fcd71c862';
const NODE_ID = 'diag_1';
const H = () => ({
  'Content-Type': 'application/json',
  Cookie: fs.readFileSync(path.join(__dirname, '.dify-cookie.txt'), 'utf8').trim(),
  'X-CSRF-Token': fs.readFileSync(path.join(__dirname, '.dify-csrf.txt'), 'utf8').trim(),
});

const args = process.argv.slice(2);
const show = args.includes('--show');
const publish = args.includes('--publish');
const setIdx = args.indexOf('--set');
const patch = setIdx >= 0 ? JSON.parse(args[setIdx + 1]) : null;

(async () => {
  const r = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, { headers: H() });
  const draft = await r.json();
  const node = draft.graph.nodes.find((n) => n.id === NODE_ID);
  if (!node) throw new Error('未找到节点 ' + NODE_ID);
  console.log('当前参数：', JSON.stringify(node.data.model.completion_params));
  console.log('当前模型：', node.data.model.name);
  if (show || !patch) return;

  node.data.model.completion_params = { ...node.data.model.completion_params, ...patch };
  console.log('目标参数：', JSON.stringify(node.data.model.completion_params));

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
  const putBody = await put.text();
  console.log('保存草稿 →', put.status, putBody.slice(0, 200));
  if (!put.ok) process.exit(1);
  console.log('提示：服务 API 跑的是已发布版本，要生效还需 --publish（或手动在控制台发布）');

  if (publish) {
    const pub = await fetch(`${BASE}/console/api/apps/${APP}/workflows/publish`, {
      method: 'POST',
      headers: H(),
      body: JSON.stringify({ marked_name: '', marked_comment: '' }),
    });
    console.log('发布 →', pub.status, (await pub.text()).slice(0, 200));
  }
})();
