// 通过 Dify 控制台 API 拉取最近工作流运行记录，量化每个节点的耗时（定位慢在哪一步）
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8180';
const H = (extra = {}) => ({
  'Content-Type': 'application/json',
  Cookie: fs.readFileSync(path.join(__dirname, '.dify-cookie.txt'), 'utf8').trim(),
  'X-CSRF-Token': fs.readFileSync(path.join(__dirname, '.dify-csrf.txt'), 'utf8').trim(),
  ...extra,
});

async function login() {
  const pwd = fs.readFileSync(path.join(__dirname, '.dify-admin-pwd.txt'), 'utf8').trim();
  const r = await fetch(BASE + '/console/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@paowu.local', password: Buffer.from(pwd, 'utf8').toString('base64'), remember_me: true }),
  });
  const d = await r.json();
  if (d.result !== 'success') throw new Error('登录失败 ' + r.status + ' ' + JSON.stringify(d).slice(0, 200));
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  const parts = sc.map((c) => c.split(';')[0]);
  let csrf = '';
  for (const p of parts) { const [k, v] = p.split('='); if (k === 'csrf_token') csrf = v; }
  fs.writeFileSync(path.join(__dirname, '.dify-cookie.txt'), parts.join('; '));
  fs.writeFileSync(path.join(__dirname, '.dify-csrf.txt'), csrf);
  console.log('登录成功');
}

const get = async (url) => {
  const r = await fetch(BASE + url, { headers: H() });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

(async () => {
  await login();
  const apps = await get('/console/api/apps?page=1&limit=100');
  const list = apps.data || [];
  console.log('应用列表：');
  list.forEach((a) => console.log(`  ${a.id}  ${a.name}  mode=${a.mode}`));
  const wf = list.find((a) => a.mode === 'workflow');
  if (!wf) return console.log('没有 workflow 类型应用');

  const runs = await get(`/console/api/apps/${wf.id}/workflow-runs?page=1&limit=10`);
  console.log(`\n最近运行（共 ${runs.total} 条）：`);
  for (const run of runs.data || []) {
    const secs = run.elapsed_time ? run.elapsed_time.toFixed(1) : '?';
    console.log(`\n=== run ${run.id} status=${run.status} 总耗时=${secs}s  ${run.created_at} trigger=${run.triggered_from}`);
    console.log(`    inputs: ${JSON.stringify(run.inputs).slice(0, 200)}`);
    try {
      const nodes = await get(`/console/api/apps/${wf.id}/workflow-runs/${run.id}/node-executions`);
      const arr = Array.isArray(nodes) ? nodes : nodes.data || [];
      for (const n of arr) {
        const t = n.elapsed_time ? Number(n.elapsed_time).toFixed(1) : '?';
        console.log(`    [${String(n.index).padStart(2)}] ${(n.title || n.node_type).padEnd(10)} ${String(n.status).padEnd(9)} ${t}s  in=${n.inputs ? JSON.stringify(n.inputs).length : 0}B out=${n.outputs ? JSON.stringify(n.outputs).length : 0}B`);
        if (n.error) console.log('        error:', String(n.error).slice(0, 200));
      }
    } catch (e) {
      console.log('    节点明细读取失败：', e.message);
    }
  }
})();
