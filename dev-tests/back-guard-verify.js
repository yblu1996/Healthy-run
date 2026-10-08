// 移动端返回手势防误触 + 学习园地返回按钮：界面级回归
// 用法：node dev-tests/back-guard-verify.js
// 前提：本机 3000 端口已在跑（只做 GET，不写库）
// 覆盖三件事：
//   ① 免密（缓存令牌）进入后，返回手势必须被拦住 —— 包括 /auth/me 还没回来的那段时间
//   ② 确认框点「确定」要真的离开本页（旧版只退一级，退到的是同一文档的根条目，界面纹丝不动）
//   ③ 学习园地的返回按钮要回到"进来之前那一页"，而不是固定回首页
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');
const { supabase } = require('../lib/db');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

let pass = 0; const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fails.push(name); console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

async function newMobileCtx(browser, token, delayMe) {
  const ctx = await browser.newContext({
    userAgent: UA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  await ctx.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, token);
  if (delayMe) {
    // 拖住 /auth/me，模拟手机弱网：这段窗口内返回手势也必须被拦住
    await ctx.route('**/api/auth/me', async (route) => {
      await new Promise((r) => setTimeout(r, delayMe));
      route.continue();
    });
  }
  return ctx;
}

const state = (page) => page.evaluate(() => {
  const m = document.getElementById('confirmModal');
  const v = document.querySelector('.view.active');
  return {
    view: v ? v.id : null,
    len: history.length,
    guard: !!(history.state && history.state.pwGuard),
    modalOpen: m ? !m.classList.contains('hidden') : false,
  };
}).catch(() => ({ view: '(页面已离开)', len: -1, guard: false, modalOpen: false }));

(async () => {
  const { data } = await supabase.from('users').select('id').limit(1);
  const uid = data && data[0] && data[0].id;
  if (!uid) { console.error('数据库里没有用户，无法自签令牌'); process.exit(1); }
  const token = jwt.sign({ id: uid }, process.env.JWT_SECRET, { expiresIn: '30m' });

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  // ---------- ① 弱网下免密进入：/auth/me 还没回来时，返回手势也要被拦住 ----------
  console.log('\n① 弱网免密进入（/auth/me 故意延迟 3s）');
  {
    const ctx = await newMobileCtx(browser, token, 3000);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);           // 此刻 /auth/me 仍在路上，首页还没渲染出来
    const early = await state(page);
    ok(early.guard, '首屏加载阶段（接口未回）哨兵已压入', JSON.stringify(early));
    await page.goBack().catch(() => {});
    await page.waitForTimeout(500);
    const after = await state(page);
    ok(after.modalOpen, '接口未回时边缘返回被拦住并弹确认框', JSON.stringify(after));
    ok(page.url().indexOf('127.0.0.1:3000') >= 0, '接口未回时没有直接掉出应用', page.url());
    await ctx.close();
  }

  // ---------- ② 确认退出：点「确定」要真的离开本页 ----------
  console.log('\n② 确认退出（在 3000 页面之上，上一页是 about:blank）');
  {
    const ctx = await newMobileCtx(browser, token, 0);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);          // 等 bootstrap 完成，落到首页
    const boot = await state(page);
    ok(boot.view === 'view-home', '免密直接落在首页', boot.view);
    ok(boot.guard, '登录后哨兵在历史里', JSON.stringify(boot));

    await page.goBack().catch(() => {});
    await page.waitForTimeout(500);
    const asked = await state(page);
    ok(asked.modalOpen, '边缘返回弹出确认框', JSON.stringify(asked));

    // 取消：留在本页，且哨兵被补回（否则下一次滑动就漏出去了）
    await page.click('#confirmCancel');
    await page.waitForTimeout(300);
    const cancelled = await state(page);
    ok(cancelled.modalOpen === false && cancelled.view === 'view-home', '取消后留在首页', JSON.stringify(cancelled));
    ok(cancelled.guard, '取消后哨兵被补回', JSON.stringify(cancelled));

    await page.goBack().catch(() => {});
    await page.waitForTimeout(500);
    const asked2 = await state(page);
    ok(asked2.modalOpen, '第二次滑动仍能弹出确认框（没有漏出去）', JSON.stringify(asked2));

    await page.click('#confirmOk');
    await page.waitForTimeout(1600);          // 退出是分级退，给足两级的时间
    ok(page.url().indexOf('127.0.0.1:3000') < 0, '点确定后真的离开了本页', page.url());
    await ctx.close();
  }

  // ---------- ③ 学习园地返回按钮：回到进来之前那一页 ----------
  console.log('\n③ 学习园地返回按钮');
  {
    const ctx = await newMobileCtx(browser, token, 0);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);

    const backInfo = () => page.evaluate(() => {
      const b = document.getElementById('learnBack');
      return b ? { text: b.textContent.trim(), nav: b.dataset.nav } : null;
    });

    await page.click('#bottomnav [data-nav="learn"]');
    await page.waitForTimeout(400);
    const fromHome = await backInfo();
    ok(fromHome && fromHome.nav === 'home' && /首页/.test(fromHome.text),
      '从首页进园地：返回按钮指向首页', JSON.stringify(fromHome));

    await page.click('#bottomnav [data-nav="history"]');
    await page.waitForTimeout(400);
    await page.click('#bottomnav [data-nav="learn"]');
    await page.waitForTimeout(400);
    const fromHistory = await backInfo();
    ok(fromHistory && fromHistory.nav === 'history' && /历史记录/.test(fromHistory.text),
      '从历史记录进园地：返回按钮指向历史记录', JSON.stringify(fromHistory));

    await page.click('#learnBack');
    await page.waitForTimeout(400);
    const landed = await state(page);
    ok(landed.view === 'view-history', '点返回真的回到历史记录', landed.view);

    // 退出页兜底（本页已是最后一页、脚本关不掉浏览器时的收尾）：只验渲染与导航隐藏
    await page.evaluate(() => { if (window.showExitScreen) window.showExitScreen(); });
    await page.waitForTimeout(300);
    const exitView = await page.evaluate(() => {
      const v = document.getElementById('view-exit');
      const r = v ? v.getBoundingClientRect() : null;
      return {
        exists: !!v,
        active: v ? v.classList.contains('active') : false,
        height: r ? Math.round(r.height) : 0,
        topnav: document.getElementById('topnav').style.display,
        bottomnav: document.getElementById('bottomnav').classList.contains('hidden'),
      };
    });
    ok(exitView.exists && exitView.active && exitView.height > 200,
      '退出页能正常渲染占满屏', JSON.stringify(exitView));
    ok(exitView.topnav === 'none' && exitView.bottomnav, '退出页隐藏顶栏与底部导航', JSON.stringify(exitView));
    await ctx.close();
  }

  // ---------- ④ 退无可退（本页是浏览器第一条记录）：用"已退出"页收尾 ----------
  // 说明：无头测试里页面下面永远垫着一个 about:blank，造不出"本页是第一条记录"的真实场景，
  // 所以这里在确认框弹出后（此时哨兵已补压）把 noPrevEntry 置真，专测这条分支。
  console.log('\n④ 确认退出 · 本页已是最后一页');
  {
    const ctx = await newMobileCtx(browser, token, 0);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.goBack().catch(() => {});
    await page.waitForTimeout(500);
    ok((await state(page)).modalOpen, '边缘返回弹出确认框', '');
    await page.evaluate(() => { noPrevEntry = true; });
    await page.click('#confirmOk');
    await page.waitForTimeout(1500);
    const exit = await page.evaluate(() => {
      const v = document.getElementById('view-exit');
      return { url: location.href, active: !!v && v.classList.contains('active'), visible: !!v && v.getBoundingClientRect().height > 200 };
    });
    ok(exit.active && exit.visible, '落到"已退出"收尾页', JSON.stringify(exit));
    await page.click('#btnReenter');
    await page.waitForTimeout(3000);
    const back = await state(page);
    ok(back.view === 'view-home' && back.guard, '点「重新进入」回到首页且守卫重新武装', JSON.stringify(back));
    await ctx.close();
  }

  await browser.close();
  console.log('\n结果：' + pass + ' 项通过，' + fails.length + ' 项失败');
  if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})();
