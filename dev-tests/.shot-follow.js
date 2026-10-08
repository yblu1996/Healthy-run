const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');
const TOKEN = jwt.sign({ id: 'fbda77bb-4eca-405e-adb0-cd25ada55ecc' }, process.env.JWT_SECRET, { expiresIn: '30m' });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await c.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, TOKEN);
  const p = await c.newPage();
  await p.goto('http://127.0.0.1:3000/', { waitUntil: 'load' });
  await p.waitForTimeout(2200);
  for (const [tag, w, h] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(300);
    await p.click('#btnFollow');
    await p.waitForTimeout(700);
    const info = await p.evaluate(() => {
      const m = document.querySelector('#followModal');
      const imgs = [...m.querySelectorAll('img')].map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, nw: i.naturalWidth, box: Math.round(i.getBoundingClientRect().width) + 'x' + Math.round(i.getBoundingClientRect().height) }));
      // 描述是否落在同一行：行高 11.5*1.35≈15.5px，两行就是 ~31px
      const caps = [...m.querySelectorAll('.follow-item span')].map(s => ({ t: s.textContent, h: Math.round(s.getBoundingClientRect().height), w: Math.round(s.getBoundingClientRect().width), lines: Math.round(s.getBoundingClientRect().height / (11.5 * 1.35)) }));
      const names = [...m.querySelectorAll('.follow-item strong')].map(s => ({ t: s.textContent, h: Math.round(s.getBoundingClientRect().height), w: Math.round(s.getBoundingClientRect().width), fs: getComputedStyle(s).fontSize, color: getComputedStyle(s).color, lines: Math.round(s.getBoundingClientRect().height / (parseFloat(getComputedStyle(s).fontSize) * 1.25)) }));
      return { visible: !m.classList.contains('hidden'), card: (() => { const r = m.querySelector('.modal-card').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })(), imgs, names, caps };
    });
    console.log(tag, JSON.stringify(info));
    await p.screenshot({ path: path.join(__dirname, '.ui-shots', 'follow-' + tag + '.png') });
    await p.evaluate(() => document.querySelector('#followClose').click());
    await p.waitForTimeout(200);
  }
  // 顺带核对「分析中」等待界面的时长文案（本次由 5-10 分钟改为 3-5 分钟）
  await p.setViewportSize({ width: 1280, height: 900 });
  const load = await p.evaluate(() => {
    const o = document.querySelector('#loadingOverlay');
    o.classList.remove('hidden');
    return {
      sub: document.querySelector('.loading-sub').textContent,
      note: document.querySelector('.loading-note').textContent,
    };
  });
  await p.waitForTimeout(400);
  console.log('loading', JSON.stringify(load));
  await p.screenshot({ path: path.join(__dirname, '.ui-shots', 'loading-copy.png') });
  await b.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
