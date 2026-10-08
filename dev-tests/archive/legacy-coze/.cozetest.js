require('dotenv').config({ path: __dirname + '/.env' });
const { runWorkflow } = require('./lib/coze');
const fs = require('fs');

// 用库里 v11 那条记录的真实图片（10 张）
const images = [
  "https://eqfiacrztkebfvugtwcs.supabase.co/storage/v1/object/public/run-images/fbda77bb-4eca-405e-adb0-cd25ada55ecc/1789706511653-37619370-9570-4542-bcb1-4a0166f3cd80.jpg",
  "https://eqfiacrztkebfvugtwcs.supabase.co/storage/v1/object/public/run-images/fbda77bb-4eca-405e-adb0-cd25ada55ecc/1789705855280-1ce87dd0-481a-4ed7-b757-32af237ca1a2.jpg",
];

(async () => {
  const out = [];
  out.push('COZE_WORKFLOW_ID=' + (process.env.COZE_WORKFLOW_ID || '(missing)'));
  out.push('COZE_PAT set=' + !!process.env.COZE_PAT);
  out.push('COZE_BASE_URL=' + (process.env.COZE_BASE_URL || 'https://api.coze.com'));
  try {
    const output = await runWorkflow({
      images,
      userText: '测试：识别这些跑步截图\n\n【填报数据】本次实际上传图片张数：2',
      goal: 'none',
      raceDate: '',
      history: '',
    });
    out.push('OUTPUT keys: ' + Object.keys(output || {}).join(','));
    out.push('RECOGNITION (full): ' + JSON.stringify(output?.recognition));
    out.push('DIAGNOSIS snippet: ' + JSON.stringify(output?.diagnosis_result?.diagnosis?.[0]?.evidence || output?.diagnosis_result?.diagnosis?.[0]?.issue));
  } catch (e) {
    out.push('THREW: ' + e.message);
    if (e.data) out.push('DATA: ' + JSON.stringify(e.data).slice(0, 1000));
  }
  fs.writeFileSync(__dirname + '/.cozetest.out.txt', out.join('\n'));
  console.log(out.join('\n'));
})();
