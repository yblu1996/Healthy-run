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
  const recObj = typeof rec === 'string' ? (() => { try { return JSON.parse(rec); } catch (e) { return {}; } })() : (rec || {});
  const m = recObj.metrics || {};
  const hasMetrics = Object.values(m).some(v => v !== null && v !== undefined);
  const line = `${label}: input=${data.usage?.input_count} output=${data.usage?.output_count} | image_error=${recObj.image_error} | metrics有值=${hasMetrics} | distance=${m.distance_km} pace=${m.avg_pace_min_per_km} hr=${m.avg_heart_rate}`;
  console.log(line);
  return line;
}

(async () => {
  const lines = [];
  const base = { user_text: '测试识图：图片里有什么跑步数据', goal: 'none', race_date: '', history: '' };

  // 修复前基线：不传图
  lines.push(await run('A 无图', { ...base }));
  // 传 1 张
  lines.push(await run('B 1张图', { ...base, image1: imageUrl }));
  // 传 3 张
  lines.push(await run('C 3张图', { ...base, image1: imageUrl, image2: imageUrl, image3: imageUrl }));

  fs.writeFileSync(__dirname + '/.verify.out.txt', lines.join('\n'));
})().catch(e => {
  const msg = 'THREW: ' + e.message;
  fs.writeFileSync(__dirname + '/.verify.out.txt', msg);
  console.log(msg);
});
