/**
 * 页面顶部截图（桌面 1280 / 手机 390），用于核对导航与按钮布局
 * 用法：node dev-tests/ui-shots.js [名称前缀]
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');

const BROWSER = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '.ui-shots');
const PREFIX = process.argv[2] || 'shot';
const TOKEN = jwt.sign({ id: process.env.VERIFY_UID || 'fbda77bb-4eca-405e-adb0-cd25ada55ecc' }, process.env.JWT_SECRET, { expiresIn: '30m' });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, TOKEN);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  const shot = async (name, clipH) => {
    const p = path.join(OUT, `${PREFIX}-${name}.png`);
    await page.screenshot({ path: p, clip: { x: 0, y: 0, width: page.viewportSize().width, height: clipH } });
    console.log('  ' + p);
  };

  for (const [label, w, h, clip] of [['desktop', 1280, 900, 190], ['mobile', 390, 844, 165]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    for (const view of ['home', 'diagnose', 'history', 'learn']) {
      await page.evaluate((v) => show(v), view);
      await page.waitForTimeout(500);
      await shot(`${label}-${view}`, clip);
    }
  }

  // 顶栏元素尺寸（判断有没有挤压/换行）
  const metrics = await page.evaluate(() => {
    const nav = document.querySelector('#topnav');
    const r = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      nav: r(nav),
      navWrapRows: Math.round(nav.getBoundingClientRect().height / parseFloat(getComputedStyle(nav).paddingTop) / 1),
      brand: r(document.querySelector('.nav-brand')),
      user: r(document.querySelector('.nav-user')),
      quota: r(document.querySelector('#quotaBadge')),
      badge: r(document.querySelector('#userBadge')),
      feedback: r(document.querySelector('#btnFeedback')),
      logout: r(document.querySelector('#btnLogout')),
      bottomnav: document.querySelector('#bottomnav').classList.contains('hidden') ? 'hidden' : r(document.querySelector('#bottomnav')),
    };
  });
  console.log('手机端顶栏尺寸：', JSON.stringify(metrics));

  await browser.close();
})().catch((e) => { console.error('异常：', e.message); process.exit(1); });
