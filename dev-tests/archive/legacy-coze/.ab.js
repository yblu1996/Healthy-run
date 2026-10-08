require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');

const BASE = process.env.COZE_BASE_URL || 'https://api.coze.cn';
const WORKFLOW_ID = process.env.COZE_WORKFLOW_ID;
const PAT = process.env.COZE_PAT;

const imageUrl = "https://eqfiacrztkebfvugtwcs.supabase.co/storage/v1/object/public/run-images/fbda77bb-4eca-405e-adb0-cd25ada55ecc/1789706511653-37619370-9570-4542-bcb1-4a0166f3cd80.jpg";

async function run(label, parameters) {
  const res = await fetch(`${BASE}/v1/workflow/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflow_id: WORKFLOW_ID, debug: true, parameters }),
  });
  const data = await res.json();
  const out = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
  const rec = out?.recognition;
  const err = typeof rec === 'string' ? (() => { try { return JSON.parse(rec).image_error; } catch (e) { return rec; } })() : rec?.image_error;
  const line = `${label}: code=${data.code} input=${data.usage?.input_count} output=${data.usage?.output_count} image_error=${err}`;
  console.log(line);
  return line;
}

(async () => {
  const lines = [];
  const base = { user_text: '测试识图：图片里有什么跑步数据', goal: 'none', race_date: '', history: '' };

  // A: 不传任何图片参数 —— 基线
  lines.push(await run('A 无图', { ...base }));

  // B: 传 1 张图
  lines.push(await run('B 1张图', { ...base, image1: imageUrl }));

  // C: 传 3 张图（同一张重复，纯粹测 token 是否随图片数增长）
  lines.push(await run('C 3张图', { ...base, image1: imageUrl, image2: imageUrl, image3: imageUrl }));

  fs.writeFileSync(__dirname + '/.ab.out.txt', lines.join('\n'));
})().catch(e => {
  const msg = 'THREW: ' + e.message;
  fs.writeFileSync(__dirname + '/.ab.out.txt', msg);
  console.log(msg);
});
