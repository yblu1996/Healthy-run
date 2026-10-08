// 生成学习园地动图总览截图（两帧对比确认动画在动）
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const DIR = path.join(__dirname, '..', 'public', 'learn-media');
const OUT = path.join(__dirname, '.ui-shots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const files = fs.readdirSync(DIR).filter((f) => /^\d{2}-(?!.*-ref).*\.svg$/.test(f)).sort();
  const cells = files.map((f) => `<div class="c"><img src="${DIR.replace(/\\/g, '/')}/${f}"><span>${f}</span></div>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;font-family:sans-serif;background:#fff}
    .grid{display:grid;grid-template-columns:repeat(3,432px);gap:10px;padding:10px}
    .c{border:1px solid #dfe7e2;border-radius:8px;padding:4px;text-align:center}
    img{width:400px;height:auto;display:block}
    span{font-size:12px;color:#666}
  </style><div class="grid">${cells}</div>`;
  fs.writeFileSync(path.join(__dirname, '.learn-sheet.html'), html);

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1340, height: 900 } });
  await page.goto(pathToFileURL(path.join(__dirname, '.learn-sheet.html')).href);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'learn-sheet-a.png'), fullPage: true });
  await page.waitForTimeout(1100);
  await page.screenshot({ path: path.join(OUT, 'learn-sheet-b.png'), fullPage: true });
  await browser.close();
  console.log('shots written to', OUT);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
