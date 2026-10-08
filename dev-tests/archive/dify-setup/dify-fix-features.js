// 修复 Dify 工作流 file_upload 配置（dict→list），带 hash 同步写回，重新发布
const fs = require('fs');
const BASE = 'http://localhost:8180';
const APP = 'c19e631c-18e0-428d-bb26-d89fcd71c862';

async function h() {
  const cookie = fs.readFileSync(__dirname + '/.dify-cookie.txt', 'utf8').trim();
  const csrf = fs.readFileSync(__dirname + '/.dify-csrf.txt', 'utf8').trim();
  return { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };
}
const dictToList = (v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v).map((k) => (k === 'local_upload' ? 'local_file' : k))
    : v;

(async () => {
  const headers = await h();
  const r1 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, { headers });
  const draft = await r1.json();
  if (!r1.ok) return console.log('GET draft failed:', r1.status);

  const f = draft.features || {};
  if (f.allowed_file_upload_methods) f.allowed_file_upload_methods = dictToList(f.allowed_file_upload_methods);
  if (f.image && f.image.transfer_methods) f.image.transfer_methods = dictToList(f.image.transfer_methods);
  if (f.file_upload) {
    if (f.file_upload.allowed_file_upload_methods) f.file_upload.allowed_file_upload_methods = dictToList(f.file_upload.allowed_file_upload_methods);
    if (f.file_upload.image && f.file_upload.image.transfer_methods) f.file_upload.image.transfer_methods = dictToList(f.file_upload.image.transfer_methods);
  }
  draft.features = f;
  console.log('fixed features:', JSON.stringify(f).slice(0, 220));

  const startNode = draft.graph.nodes.find((n) => n.data.type === 'start');
  for (const v of startNode.data.variables || []) {
    if (v.type === 'file-list') {
      v.allowed_file_upload_methods = ['local_file', 'remote_url'];
      v.allowed_file_types = ['image'];
    }
  }

  const r2 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      graph: draft.graph,
      features: draft.features,
      environment_variables: draft.environment_variables || [],
      conversation_variables: draft.conversation_variables || [],
      hash: draft.hash,
    }),
  });
  console.log('PUT draft:', r2.status, (await r2.text()).slice(0, 150));
  if (r2.status !== 200) process.exit(1);

  const r3 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/publish`, { method: 'POST', headers });
  console.log('publish:', r3.status, (await r3.text()).slice(0, 150));
})();
