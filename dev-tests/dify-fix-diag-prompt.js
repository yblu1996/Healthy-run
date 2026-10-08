// 消歧 Dify「诊断计划」节点提示词里的输出格式要求：
// 原文「严格按此 JSON，不要增减字段」与「备战模式需增加 goal_feasibility / race_day_strategy」
// 互相矛盾，降低思考强度后模型会直接省略这两个字段。这里把输出格式拆成
// 「1) 基础字段」+「2) 备战模式额外字段」，只做消歧，不改变任何产品规则。
// 用法：node dev-tests/dify-fix-diag-prompt.js [--publish]
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8180';
const APP = 'c19e631c-18e0-428d-bb26-d89fcd71c862';
const H = () => ({
  'Content-Type': 'application/json',
  Cookie: fs.readFileSync(path.join(__dirname, '.dify-cookie.txt'), 'utf8').trim(),
  'X-CSRF-Token': fs.readFileSync(path.join(__dirname, '.dify-csrf.txt'), 'utf8').trim(),
});

const OLD_HEAD = '输出格式（严格按此 JSON，不要增减字段，不要输出 JSON 以外的内容，不要用 ```json 围栏包裹）：';
const NEW_HEAD = '输出格式（不要输出 JSON 以外的内容，不要用 ```json 围栏包裹）：\n1) 基础字段（任何情况都必须输出）：';

const OLD_TAIL = '  "next_check": "下次复诊建议（通常 4 周后重新上传数据）"\n}';
const NEW_TAIL = `  "next_check": "下次复诊建议（通常 4 周后重新上传数据）"
}
2) 备战模式的额外字段：当 goal 不是 none 时，必须在上面同一个 JSON 对象里追加下面两个字段（与 next_check 同级），缺失视为不合格输出；goal 为 none 时不要输出这两个字段。
{
  "goal_feasibility": "目标可行性评估：以当前数据看目标是否合理、是否激进、预计完赛区间",
  "race_day_strategy": "比赛日配速与补给策略"
}`;

(async () => {
  const draft = await (await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, { headers: H() })).json();
  const node = draft.graph.nodes.find((n) => n.id === 'diag_1');
  const sys = node.data.prompt_template.find((p) => p.id === 'diag-sys');

  if (!sys.text.includes(OLD_HEAD)) throw new Error('未找到输出格式首段，提示词可能已改动');
  if (!sys.text.includes(OLD_TAIL)) throw new Error('未找到输出格式尾段，提示词可能已改动');
  if (sys.text.includes('2) 备战模式的额外字段')) return console.log('已经改过，跳过');

  sys.text = sys.text
    .replace(OLD_HEAD, NEW_HEAD)
    .replace(OLD_TAIL, NEW_TAIL);
  console.log('系统提示词已更新，长度', sys.text.length);

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
