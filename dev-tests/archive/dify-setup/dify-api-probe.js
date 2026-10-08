// Dify 服务 API 直测：分段诊断（先空图/文本探活，再带真实图全链路）
const fs = require('fs');
const path = require('path');
const KEY = fs.readFileSync(path.join(__dirname, '.dify-appkey.txt'), 'utf8').trim();
const BASE = 'http://localhost:8180';

async function run(inputs, label) {
  const t0 = Date.now();
  const res = await fetch(BASE + '/v1/workflows/run', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs, response_mode: 'streaming', user: 'paowu-test' }),
  });
  if (!res.ok) {
    console.log(label, '-> HTTP', res.status, (await res.text()).slice(0, 200));
    return null;
  }
  // 读 SSE 直到 workflow_finished
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', status = null, outputs = null, nodeEvents = [];
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
        if (e.event === 'node_finished') nodeEvents.push((e.data && (e.data.title || e.data.node_type)) + ':' + (e.data && e.data.status));
        if (e.event === 'workflow_finished') { status = e.data && e.data.status; outputs = e.data && e.data.outputs; }
        if (e.event === 'error') { status = 'error'; console.log(label, 'ERROR EVENT:', e.message); }
      } catch {}
    }
  }
  console.log(label, '->', status, '|', ((Date.now() - t0) / 1000).toFixed(1) + 's', '| nodes:', nodeEvents.join(' → '));
  if (outputs) fs.writeFileSync(path.join(__dirname, '.dify-' + label.replace(/\W/g, '') + '.json'), JSON.stringify(outputs, null, 2));
  return outputs;
}

(async () => {
  // 探活：空图纯文本（识图节点会返回 unclear，但整条链路应走完）
  await run({ user_text: '探活测试：45岁女性，周跑量25公里，无伤病。', goal: 'none', race_date: '', history: '[]', images: [] }, 'probe');
})();
