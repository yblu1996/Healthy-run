require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');

const BASE = process.env.COZE_BASE_URL || 'https://api.coze.cn';
const WORKFLOW_ID = process.env.COZE_WORKFLOW_ID;
const PAT = process.env.COZE_PAT;

(async () => {
  const res = await fetch(`${BASE}/v1/workflows/${WORKFLOW_ID}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  fs.writeFileSync(__dirname + '/.wf_full.json', JSON.stringify(data, null, 2));
  // 打印所有 key 路径，找节点配置/变量名/发布状态藏在哪
  function listKeys(obj, prefix, depth, out) {
    if (depth > 5 || obj === null || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const path = prefix ? `${prefix}.${k}` : k;
      const typ = Array.isArray(v) ? 'array' : typeof v;
      const preview = (typ === 'string') ? ` = "${v.slice(0,60)}"` : (typ === 'array' ? ` [len=${v.length}]` : '');
      out.push(`${path} (${typ})${preview}`);
      if (typ === 'object' || typ === 'array') listKeys(v, path, depth + 1, out);
    }
  }
  const out = [];
  listKeys(data, '', 0, out);
  fs.writeFileSync(__dirname + '/.wf_keys.txt', out.join('\n'));
  console.log(out.join('\n'));
})().catch(e => console.log('THREW: ' + e.message));
