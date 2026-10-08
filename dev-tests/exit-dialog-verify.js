/**
 * 退出确认弹窗统一性验证（无头 Chrome）
 *
 * 断言两个退出确认框（右上角"退出登录"按钮 / 移动端边缘滑动返回，两者共用 #confirmModal）：
 *  1) 标题一致（退出跑悟）、按钮文字一致（取消/确定），正文按场景各一句（句式一致）
 *  2) 卡片宽度一致；确定/取消按钮等高（此前 ghost 与 danger 差 4px、字号差 1px）
 *  3) 手机端：按钮等宽双列、无横向溢出
 * 截图：.ui-shots/exit-dialog-{logout,swipe}-{desktop,mobile}.png
 *
 * 注：弹窗内按钮用 evaluate 派发 click——headless 下 Playwright 对该按钮的 actionability
 * 预检与页面内测量结果矛盾（rect 104×41、elementFromPoint 命中自己，仍报 not visible），
 * 本脚本验证的是 UI 数据与处理器逻辑，不依赖手势可信度。
 *
 * 用法：node dev-tests/exit-dialog-verify.js   （只读操作，打正在跑的 3000）
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

const clickInPage = (page, sel) =>
  page.evaluate((s) => document.querySelector(s).click(), sel);

async function dialogState(page, shot) {
  await page.screenshot({ path: shot });
  return page.evaluate(() => {
    const card = document.querySelector('#confirmModal .modal-card');
    const cancel = document.querySelector('#confirmCancel');
    const ok = document.querySelector('#confirmOk');
    const cr = card.getBoundingClientRect(), kr = ok.getBoundingClientRect(), xr = cancel.getBoundingClientRect();
    return {
      title: document.querySelector('#confirmTitle').textContent,
      msg: document.querySelector('#confirmMessage').textContent,
      cardW: Math.round(cr.width), cardH: Math.round(cr.height),
      okH: Math.round(kr.height), cancelH: Math.round(xr.height),
      okW: Math.round(kr.width), cancelW: Math.round(xr.width),
      visible: !document.querySelector('#confirmModal').classList.contains('hidden'),
    };
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });

  // ---- 桌面 ----
  // 用移动 UA + 宽视口：滑动返回拦截（armBackGuard）只武装 isMobile 环境，
  // 桌面 UA 下 onGuardPop 会因 guardWanted=false 直接返回，弹不出第二个框
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, TOKEN);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  // ① 右上角「退出」按钮 → 退出登录确认框
  await clickInPage(page, '#btnLogout');
  await page.waitForTimeout(400);
  const lg = await dialogState(page, path.join(OUT, 'exit-dialog-logout-desktop.png'));
  await clickInPage(page, '#confirmCancel');
  await page.waitForTimeout(200);

  // ② 移动端滑动返回的触发路径：直接调 onGuardPop 走真实代码路径
  await page.evaluate(() => onGuardPop());
  await page.waitForTimeout(400);
  const sw = await dialogState(page, path.join(OUT, 'exit-dialog-swipe-desktop.png'));
  await clickInPage(page, '#confirmCancel');
  await ctx.close();

  check('两个框都正常弹出', lg.visible && sw.visible);
  check('标题统一（退出跑悟）', lg.title === '退出跑悟' && sw.title === '退出跑悟', `${lg.title} / ${sw.title}`);
  check('正文按场景各一句、句式一致', lg.msg !== sw.msg && /你的报告会安全保留/.test(lg.msg) && /你的报告会安全保留/.test(sw.msg), '');
  check('桌面卡片宽度一致', lg.cardW === sw.cardW, `${lg.cardW} vs ${sw.cardW}`);
  check('确定/取消按钮等高', lg.okH === lg.cancelH && sw.okH === sw.cancelH, `logout ${lg.okH}/${lg.cancelH}  swipe ${sw.okH}/${sw.cancelH}`);
  check('两框按钮规格一致', lg.okH === sw.okH && lg.cancelH === sw.cancelH);

  // ---- 手机（微信 UA）----
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile MicroMessenger/8.0.42' });
  await mctx.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, TOKEN);
  const mp = await mctx.newPage();
  await mp.goto(BASE + '/', { waitUntil: 'load' });
  await mp.waitForTimeout(1800);

  // 手机端顶栏按钮可能随 UA 隐藏：用 JS 触发同一 handler（本脚本验证的是弹窗 UI，非手势）
  await clickInPage(mp, '#btnLogout');
  await mp.waitForTimeout(400);
  const mlg = await dialogState(mp, path.join(OUT, 'exit-dialog-logout-mobile.png'));
  await clickInPage(mp, '#confirmCancel');
  await mp.waitForTimeout(200);
  await mp.evaluate(() => onGuardPop());
  await mp.waitForTimeout(400);
  const msw = await dialogState(mp, path.join(OUT, 'exit-dialog-swipe-mobile.png'));
  const mob = await mp.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  await clickInPage(mp, '#confirmCancel');
  await mctx.close();

  check('手机端两框标题统一', mlg.title === '退出跑悟' && msw.title === '退出跑悟', `${mlg.title} / ${msw.title}`);
  check('手机端按钮等宽（双列铺满）', Math.abs(mlg.okW - mlg.cancelW) <= 2 && Math.abs(msw.okW - msw.cancelW) <= 2, `logout ${mlg.okW}/${mlg.cancelW}  swipe ${msw.okW}/${msw.cancelW}`);
  check('手机端无横向溢出', !mob.overflow);
  check('手机端卡片宽度一致', mlg.cardW === msw.cardW, `${mlg.cardW} vs ${msw.cardW}`);

  await browser.close();
  console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
