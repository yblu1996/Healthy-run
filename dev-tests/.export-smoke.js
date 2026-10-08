// 临时冒烟：验证导出长图不再重码（details 折叠内容不再叠画到 summary 上）
// 用法：node dev-tests/.export-smoke.js
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');

const BROWSER = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:3000';
const TOKEN = jwt.sign({ id: process.env.VERIFY_UID || 'fbda77bb-4eca-405e-adb0-cd25ada55ecc' }, process.env.JWT_SECRET, { expiresIn: '30m' });
const RECORD_ID = 'fd203299-f068-48f9-a3fe-767ab62a9c9e';
const OUT = path.join(__dirname, '.export-out');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, TOKEN);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE-ERROR:', e.message));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  // 直接调全局 openRecord 打开最新报告
  await page.evaluate((id) => window.openRecord(id), RECORD_ID);
  await page.waitForTimeout(2500);

  // 记录 details 数量与展开前状态
  const info = await page.evaluate(() => ({
    detailsCount: document.querySelectorAll('#reportBody details').length,
    anyOpenBefore: [...document.querySelectorAll('#reportBody details')].some((d) => d.open),
  }));
  console.log('details 数量:', info.detailsCount, '| 展开前任一展开:', info.anyOpenBefore);

  // 调用导出截图（真实走 captureReport）
  const dataUrl = await page.evaluate(async () => {
    const canvas = await window.captureReport('smoke');
    return canvas.toDataURL('image/png');
  });
  const b64 = dataUrl.split(',')[1];
  fs.writeFileSync(path.join(OUT, 'export-smoke.png'), Buffer.from(b64, 'base64'));
  console.log('长图已保存:', path.join(OUT, 'export-smoke.png'));

  // 确认页面上的 details 已还原为折叠
  const after = await page.evaluate(() => [...document.querySelectorAll('#reportBody details')].map((d) => d.open));
  console.log('导出后 details 状态(应与导出前一致，默认全 false):', JSON.stringify(after));
  await browser.close();
})();
