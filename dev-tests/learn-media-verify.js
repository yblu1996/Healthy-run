/**
 * 学习园地动图接入验证（无头 Chrome）
 *
 * 断言：
 *  1) 18 张原创示意动图全部渲染且加载成功（naturalWidth > 0）
 *  2) 每张都有图注；顶部原创声明（learn-credit）渲染
 *  3) 三大板块（跑姿/热身恢复/力量）的条目都带 media
 *  4) 手机端无横向溢出
 *  5) 截图：桌面 + 手机（.ui-shots/learn-{desktop,mobile}.png）
 *
 * 用法：node dev-tests/learn-media-verify.js   （打正在跑的 3000，只读操作）
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3000';
const TOKEN = jwt.sign({ id: 'fbda77bb-4eca-405e-adb0-cd25ada55ecc' }, process.env.JWT_SECRET, { expiresIn: '30m' });
const OUT = path.join(__dirname, '.ui-shots');
let fails = 0;
const check = (n, c, d) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, TOKEN);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  // 走真实用户路径：点顶部导航进学习园地（loadLearn 由导航点击触发，直接 show() 不会拉内容）
  await page.click('.topnav a[data-nav="learn"]');
  await page.waitForTimeout(1000);
  // 展开全部条目
  await page.evaluate(() => document.querySelectorAll('.learn-head').forEach((h) => {
    if (h.parentElement.classList.contains('open')) return;
    h.click();
  }));
  await page.waitForTimeout(600);
  // 动图是 loading="lazy"：逐段滚到底触发懒加载，再滚回顶部
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 500));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);

  const r = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.learn-media img.learn-img')];
    const figs = [...document.querySelectorAll('.learn-fig')];
    return {
      total: imgs.length,
      loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      withCaption: figs.filter((f) => f.querySelector('figcaption') && f.querySelector('figcaption').textContent.trim()).length,
      credit: !!document.querySelector('.learn-credit'),
      creditText: (document.querySelector('.learn-credit') || {}).textContent || '',
      mediaItems: document.querySelectorAll('.learn-item .learn-media').length,
      note: !!document.querySelector('#learnBody .section-desc'),
      terms: document.querySelectorAll('.fig-term').length,
      benefits: document.querySelectorAll('.fig-row .fig-k').length,
      musclePills: document.querySelectorAll('.fig-tags i').length,
      cautions: document.querySelectorAll('.fig-caution').length,
    };
  });
  check('动图总数 = 18', r.total === 18, String(r.total));
  check('动图全部加载成功', r.loaded === r.total, `loaded=${r.loaded} broken=${JSON.stringify(r.broken)}`);
  check('每张动图都有图注', r.withCaption === r.total, `${r.withCaption}/${r.total}`);
  check('顶部原创声明渲染', r.credit && r.media_note !== false, r.creditText.trim().slice(0, 30));
  check('带动图的条目数 ≥ 6', r.mediaItems >= 6, String(r.mediaItems));
  check('免责声明渲染', r.note);
  check('功能卡：18 张都有学名徽章', r.terms === 18, String(r.terms));
  check('功能卡：功效/肌肉/注意行齐全（≥54 行）', r.benefits >= 54, String(r.benefits));
  check('功能卡：肌肉标签药丸 ≥ 36 个', r.musclePills >= 36, String(r.musclePills));
  check('功能卡：18 行注意事项', r.cautions === 18, String(r.cautions));

  await page.screenshot({ path: path.join(OUT, 'learn-desktop.png'), fullPage: true });

  // 手机端
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile MicroMessenger/8.0.42' });
  await mctx.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, TOKEN);
  const mpage = await mctx.newPage();
  await mpage.goto(BASE + '/', { waitUntil: 'load' });
  await mpage.waitForTimeout(1500);
  // 手机端顶栏该链接不可见：直接调视图函数（导航行为由桌面端覆盖）
  await mpage.evaluate(() => { show('learn'); loadLearn(); });
  await mpage.waitForTimeout(1000);
  await mpage.evaluate(() => document.querySelectorAll('.learn-head').forEach((h) => {
    if (h.parentElement.classList.contains('open')) return;
    h.click();
  }));
  await mpage.waitForTimeout(600);
  await mpage.evaluate(async () => {
    const step = window.innerHeight * 0.8;
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 500));
    window.scrollTo(0, 0);
  });
  await mpage.waitForTimeout(1000);
  const m = await mpage.evaluate(async () => {
    await new Promise((res) => { let n = 0; const imgs = document.querySelectorAll('.learn-media img');
      imgs.forEach((i) => { if (i.complete) n++; else i.onload = i.onerror = () => { n++; if (n === imgs.length) res(); }; });
      if (n === imgs.length) res(); });
    return {
      loaded: [...document.querySelectorAll('.learn-media img')].filter((i) => i.naturalWidth > 0).length,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      scrollW: document.documentElement.scrollWidth,
    };
  });
  check('手机端动图全部加载', m.loaded === 18, String(m.loaded));
  check('手机端无横向溢出', !m.overflow, `scrollW=${m.scrollW}`);
  await mpage.screenshot({ path: path.join(OUT, 'learn-mobile.png'), fullPage: true });
  check('无页面脚本错误', errors.length === 0, errors.join('; ').slice(0, 120));

  await browser.close();
  console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
