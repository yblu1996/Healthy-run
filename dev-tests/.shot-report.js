const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');
const TOKEN = jwt.sign({ id: 'fbda77bb-4eca-405e-adb0-cd25ada55ecc' }, process.env.JWT_SECRET, { expiresIn: '30m' });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  await c.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, TOKEN);
  const p = await c.newPage();
  await p.goto('http://127.0.0.1:3000/', { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  await p.evaluate(async () => {
    const d = await (await fetch('/tmp-verify-payload.json')).json();
    show('report'); renderReport(d);
    document.querySelector('#riskBanner').classList.add('hidden');
  });
  await p.waitForTimeout(600);
  const geo = await p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    return { topnav: r('#topnav'), reportTop: r('.report-top'), navVisible: !document.querySelector('#reportActions').classList.contains('hidden'), barText: document.querySelector('.btn-back').textContent };
  });
  console.log('几何：', JSON.stringify(geo));
  await p.screenshot({ path: path.join(__dirname, '.ui-shots', 'report-mobile-top.png'), clip: { x: 0, y: 0, width: 390, height: 190 } });
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
