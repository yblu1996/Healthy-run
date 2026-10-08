require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');

const BASE = process.env.COZE_BASE_URL || 'https://api.coze.com';
const WORKFLOW_ID = process.env.COZE_WORKFLOW_ID;
const PAT = process.env.COZE_PAT;

const imageUrl = "https://eqfiacrztkebfvugtwcs.supabase.co/storage/v1/object/public/run-images/fbda77bb-4eca-405e-adb0-cd25ada55ecc/1789706511653-37619370-9570-4542-bcb1-4a0166f3cd80.jpg";

(async () => {
  const out = [];
  // debug 模式：返回里会带每个节点的输入输出
  const res = await fetch(`${BASE}/v1/workflow/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      workflow_id: WORKFLOW_ID,
      debug: true,
      parameters: {
        image1: imageUrl,
        user_text: '测试识图',
        goal: 'none',
        race_date: '',
        history: '',
      },
    }),
  });
  const data = await res.json();
  out.push('HTTP ' + res.status);
  out.push('code=' + data.code + ' msg=' + data.msg);
  // debug 信息通常在 data 字符串里
  const raw = typeof data.data === 'string' ? data.data : JSON.stringify(data.data);
  out.push('DATA (raw, first 3000 chars):');
  out.push(raw.slice(0, 3000));
  fs.writeFileSync(__dirname + '/.debug.out.txt', out.join('\n'));
  console.log(out.join('\n'));
})().catch(e => {
  const msg = 'THREW: ' + e.message;
  fs.writeFileSync(__dirname + '/.debug.out.txt', msg);
  console.log(msg);
});
