const path = require('path');
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const p = await (await b.newContext()).newPage();
  await p.goto('http://127.0.0.1:3000/');
  const src = 'data:image/png;base64,' + require('fs').readFileSync(path.join(__dirname, '.export-out', 'report.png')).toString('base64');
  const out = await p.evaluate(async (s) => {
    const img = new Image(); img.src = s; await img.decode();
    // 取图片底部 620px（水印区）
    const h = 620, y0 = img.naturalHeight - h;
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, y0, img.naturalWidth, h, 0, 0, img.naturalWidth, h);
    return { total: img.naturalWidth + 'x' + img.naturalHeight, data: cv.toDataURL('image/png') };
  }, src);
  console.log('原图', out.total);
  require('fs').writeFileSync(path.join(__dirname, '.ui-shots', 'wm-crop.png'), Buffer.from(out.data.split(',')[1], 'base64'));
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
