require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');

const BASE = process.env.COZE_BASE_URL || 'https://api.coze.cn';
const WORKFLOW_ID = process.env.COZE_WORKFLOW_ID;
const PAT = process.env.COZE_PAT;

// 试几个可能的"获取工作流详情"endpoint
const endpoints = [
  `/v1/workflows/${WORKFLOW_ID}`,
  `/v1/workflow/get?workflow_id=${WORKFLOW_ID}`,
  `/v1/workflows/${WORKFLOW_ID}/detail`,
];

(async () => {
  const out = [];
  for (const ep of endpoints) {
    try {
      const res = await fetch(`${BASE}${ep}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      });
      const text = await res.text();
      out.push(`GET ${ep} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
    } catch (e) {
      out.push(`GET ${ep} -> THREW: ${e.message}`);
    }
  }
  fs.writeFileSync(__dirname + '/.wf.out.txt', out.join('\n'));
  console.log(out.join('\n'));
})().catch(e => console.log('THREW: ' + e.message));
