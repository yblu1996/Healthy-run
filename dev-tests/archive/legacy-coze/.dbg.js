require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');

const BASE = process.env.COZE_BASE_URL || 'https://api.coze.com';
const WORKFLOW_ID = process.env.COZE_WORKFLOW_ID;
const PAT = process.env.COZE_PAT;

const imageUrl = "https://eqfiacrztkebfvugtwcs.supabase.co/storage/v1/object/public/run-images/fbda77bb-4eca-405e-adb0-cd25ada55ecc/1789706511653-37619370-9570-4542-bcb1-4a0166f3cd80.jpg";

// 递归列出对象的所有 key 路径，找节点级 debug 数据藏在哪
function listKeys(obj, prefix, depth, out) {
  if (depth > 4 || obj === null || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const path = prefix ? `${prefix}.${k}` : k;
    const typ = Array.isArray(v) ? 'array' : typeof v;
    out.push(`${path} (${typ})`);
    if (typ === 'object' || (typ === 'array' && v.length > 0)) {
      listKeys(v, path, depth + 1, out);
    }
  }
}

(async () => {
  const out = [];
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
        user_text: '测试识图：图片里有什么跑步数据',
        goal: 'none',
        race_date: '',
        history: '',
      },
    }),
  });
  const data = await res.json();
  out.push('HTTP ' + res.status);
  out.push('TOP KEYS: ' + Object.keys(data).join(','));
  out.push('code=' + data.code + ' msg=' + data.msg);

  // 列出完整结构
  out.push('--- STRUCTURE ---');
  listKeys(data, '', 0, out);

  // 完整原始返回（写全文，另存一份长的）
  fs.writeFileSync(__dirname + '/.dbg_full.json', JSON.stringify(data, null, 2));
  out.push('FULL JSON written to .dbg_full.json, size=' + JSON.stringify(data).length);

  fs.writeFileSync(__dirname + '/.dbg.out.txt', out.join('\n'));
  console.log(out.join('\n'));
})().catch(e => {
  const msg = 'THREW: ' + e.message;
  fs.writeFileSync(__dirname + '/.dbg.out.txt', msg);
  console.log(msg);
});
