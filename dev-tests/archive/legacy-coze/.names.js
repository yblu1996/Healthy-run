require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');

const BASE = process.env.COZE_BASE_URL || 'https://api.coze.cn';
const WORKFLOW_ID = process.env.COZE_WORKFLOW_ID;
const PAT = process.env.COZE_PAT;

const imageUrl = "https://eqfiacrztkebfvugtwcs.supabase.co/storage/v1/object/public/run-images/fbda77bb-4eca-405e-adb0-cd25ada55ecc/1789706511653-37619370-9570-4542-bcb1-4a0166f3cd80.jpg";

async function run(label, parameters) {
  try {
    const res = await fetch(`${BASE}/v1/workflow/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow_id: WORKFLOW_ID, debug: true, parameters }),
    });
    const data = await res.json();
    const input = data.usage?.input_count;
    const line = `${label}: input=${input} code=${data.code}`;
    console.log(line);
    return line;
  } catch (e) {
    const line = `${label}: THREW ${e.message}`;
    console.log(line);
    return line;
  }
}

(async () => {
  const lines = [];
  const base = { user_text: '测', goal: 'none', race_date: '', history: '' };

  // 同一张图，试不同的参数名变体。谁的 input 显著变大（>2000），谁就是扣子真正认识的变量名
  lines.push(await run('小写 image1', { ...base, image1: imageUrl }));
  lines.push(await run('大写 Image1', { ...base, Image1: imageUrl }));
  lines.push(await run('全大写 IMAGE1', { ...base, IMAGE1: imageUrl }));

  fs.writeFileSync(__dirname + '/.names.out.txt', lines.join('\n'));
})().catch(e => console.log('THREW: ' + e.message));
