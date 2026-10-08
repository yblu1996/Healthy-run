// 验证三项修复：①学习园地移动端不挤压 ②账号与安全折叠模块 ③目标评估显示真实文字+目标徽标
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');

const TOKEN = jwt.sign({ id: 'fbda77bb-4eca-405e-adb0-cd25ada55ecc' }, process.env.JWT_SECRET, { expiresIn: '30m' });
const OUT = path.join(__dirname, '.ui-shots');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, TOKEN);
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  // ① 学习园地
  await page.evaluate(() => document.querySelector('[data-nav="learn"]').click());
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelectorAll('#learnBody .learn-head')[0].click());
  await page.waitForTimeout(600);
  const layout = await page.evaluate(() => {
    const media = document.querySelector('.learn-media');
    const figs = [...document.querySelectorAll('.learn-media .learn-fig')];
    return {
      cols: getComputedStyle(media).gridTemplateColumns,
      figWs: figs.map((f) => Math.round(f.getBoundingClientRect().width)),
      overflowX: document.body.scrollWidth > innerWidth,
    };
  });
  console.log('① 学习园地:', JSON.stringify(layout));

  // ② 账号与安全面板
  await page.evaluate(() => document.querySelector('[data-nav="home"]').click());
  await page.waitForTimeout(800);
  const collapsed = await page.evaluate(() => {
    const body = document.getElementById('accountSafetyBody');
    const btn = document.getElementById('btnSaveSecq');
    return { bodyHidden: body.classList.contains('hidden'), saveBtnInCollapsed: !btn.offsetParent };
  });
  console.log('② 折叠态:', JSON.stringify(collapsed));
  await page.evaluate(() => document.getElementById('accountSafetyToggle').click());
  await page.waitForTimeout(300);
  const expanded = await page.evaluate(() => {
    const btn = document.getElementById('btnSaveSecq');
    const r = btn.getBoundingClientRect();
    return { saveBtnW: Math.round(r.width), fullRow: r.width > 300, boxes: document.querySelectorAll('.as-box').length };
  });
  console.log('② 展开态:', JSON.stringify(expanded));

  // ③ 目标评估
  await page.evaluate(() => document.querySelector('[data-nav="history"]').click());
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelectorAll('#historyList .history-item')[0].click());
  await page.waitForTimeout(2000);
  const goal = await page.evaluate(() => {
    const card = document.getElementById('card-goal');
    if (!card) return { card: false };
    return {
      card: true,
      title: card.querySelector('h3').textContent.trim(),
      body: (card.querySelector('p') || {}).textContent?.trim().slice(0, 50),
      isDash: (card.querySelector('p') || {}).textContent?.trim() === '—',
    };
  });
  console.log('③ 目标评估:', JSON.stringify(goal));
  await page.screenshot({ path: path.join(OUT, 'goal-card.png'), fullPage: false });
  await browser.close();
})();
