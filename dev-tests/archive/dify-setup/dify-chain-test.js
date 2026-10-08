// 链式两 LLM 节点测试：第二个节点引用第一个节点的输出
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8180';

async function h() {
  return {
    Cookie: fs.readFileSync(path.join(__dirname, '.dify-cookie.txt'), 'utf8').trim(),
    'X-CSRF-Token': fs.readFileSync(path.join(__dirname, '.dify-csrf.txt'), 'utf8').trim(),
    'Content-Type': 'application/json',
  };
}

(async () => {
  const headers = await h();
  const yaml = fs.readFileSync(path.join(__dirname, 'dify-chain-test-dsl.yaml'), 'utf8');
  const imp = await (await fetch(BASE + '/console/api/apps/imports', { method: 'POST', headers, body: JSON.stringify({ mode: 'yaml-content', yaml_content: yaml }) })).json();
  if (!imp.app_id) return console.log('import failed:', JSON.stringify(imp).slice(0, 200));
  console.log('imported app:', imp.app_id);

  let kr = await (await fetch(`${BASE}/console/api/apps/${imp.app_id}/api-keys`, { headers })).json();
  let key = kr.data && kr.data[0] && kr.data[0].token;
  if (!key) {
    kr = await (await fetch(`${BASE}/console/api/apps/${imp.app_id}/api-keys`, { method: 'POST', headers, body: '{}' })).json();
    key = kr.token || (kr.data && kr.data.token);
  }

  const pr = await fetch(`${BASE}/console/api/apps/${imp.app_id}/workflows/publish`, { method: 'POST', headers, body: '{}' });
  console.log('publish:', pr.status);

  const t0 = Date.now();
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(BASE + '/v1/workflows/run', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { q: '说：你好' }, response_mode: 'streaming', user: 'paowu-test' }),
      signal: ctrl.signal,
    });
    console.log('run http:', res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', out = null, nodes = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const l of lines) {
        const t = l.trim();
        if (!t.startsWith('data:')) continue;
        try {
          const e = JSON.parse(t.slice(5).trim());
          if (e.event === 'node_finished') nodes.push((e.data.title || '') + ':' + e.data.status + ':' + (e.data.elapsed_time || 0).toFixed(1) + 's');
          if (e.event === 'workflow_finished') out = e.data;
          if (e.event === 'error') console.log('ERROR EVENT:', e.message);
        } catch {}
      }
    }
    clearTimeout(tm);
    console.log('nodes:', nodes.join(' | '));
    console.log('finished:', out && out.status, '| outputs:', JSON.stringify(out && out.outputs).slice(0, 150));
    console.log('total:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  } catch (e) {
    clearTimeout(tm);
    console.log('RESULT: HANG/ABORT after', ((Date.now() - t0) / 1000).toFixed(0) + 's', '(' + e.name + ') → 链式第二节点引用输出 = 复现挂起');
  }
})();
