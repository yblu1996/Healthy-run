// A 组法律合规改动的真机渲染核对：
//   ① 注册页协议勾选（仅注册模式显示，checkbox 不被表单样式撑大）
//   ② 诊断页第 1 步的健康数据单独同意（横向布局 + 底框）
//   ③ 全局页脚（版权行 + 三份文本入口，移动端不被底部导航盖住）
//   ④ 三个独立法律文本页的排版
// 用法：NODE_PATH=<托管 node workspace> node dev-tests/.shot-legal.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');

const TOKEN = jwt.sign({ id: 'fbda77bb-4eca-405e-adb0-cd25ada55ecc' }, process.env.JWT_SECRET, { expiresIn: '30m' });
const OUT = (f) => path.join(__dirname, '.ui-shots', f);

const measure = (p) => p.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); };
  const health = document.querySelector('#consentHealth');
  const terms = document.querySelector('#agreeTerms');
  const row = document.querySelector('.consent-row');
  const foot = document.querySelector('.site-foot');
  return {
    注册勾选框: box(terms),
    注册勾选框可见: terms ? terms.offsetParent !== null : false,
    健康数据勾选框: box(health),
    同意行方向: row ? getComputedStyle(row).flexDirection : null,
    同意行尺寸: box(row),
    页脚高度: foot ? Math.round(foot.getBoundingClientRect().height) : null,
    页脚文案: foot ? foot.innerText.replace(/\s+/g, ' ').trim() : null,
  };
});

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

    // ① 诊断页第 1 步：健康数据单独同意
    await p.evaluate(() => window.show('diagnose'));
    await p.waitForTimeout(400);
    await p.evaluate(() => { const r = document.querySelector('.consent-row'); r.scrollIntoView({ block: 'center' }); });
    await p.waitForTimeout(300);
    console.log('[诊断页]', tag, JSON.stringify(await measure(p)));
    await p.screenshot({ path: OUT('legal-consent-' + tag + '.png') });

    // ② 页脚（滚到页面最底）
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p.waitForTimeout(400);
    const foot = await p.evaluate(() => {
      const f = document.querySelector('.site-foot');
      const bn = document.querySelector('#bottomnav');
      const last = f.querySelector('p:last-of-type');
      // 判据用"最后一个文字行的底边"而不是页脚元素的边界：
      // 页脚带 86px 下内边距是刻意的避让空间，含进去会把正常布局误判成遮挡
      const lr = last.getBoundingClientRect();
      const br = bn.getBoundingClientRect();
      const navShown = br.height > 0;
      return {
        页脚文字底边: Math.round(lr.bottom),
        视口高: window.innerHeight,
        底部导航顶部: navShown ? Math.round(br.top) : null,
        正文被遮挡: navShown ? Math.round(lr.bottom) > Math.round(br.top) : false,
        备案行是否已出现: /ICP备\d/.test(f.innerText),
      };
    });
    console.log('[页脚]', tag, JSON.stringify(foot));
    await p.screenshot({ path: OUT('legal-footer-' + tag + '.png') });
  }

  // ③ 注册态：协议勾选（logout 会清 token，所以放在最后）
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => { window.logout(); window.switchAuth('register'); });
  await p.waitForTimeout(500);
  console.log('[注册页]', JSON.stringify(await measure(p)));
  await p.screenshot({ path: OUT('legal-register-mobile.png'), fullPage: true });

  // ④ 三份独立法律文本页
  const p2 = await c.newPage();
  const pages = [['terms', 1280, 900], ['privacy', 390, 844], ['disclaimer', 390, 844]];
  for (const [name, w, h] of pages) {
    await p2.setViewportSize({ width: w, height: h });
    await p2.goto('http://127.0.0.1:3000/legal/' + name + '.html', { waitUntil: 'load' });
    await p2.waitForTimeout(500);
    const info = await p2.evaluate(() => ({
      标题: document.querySelector('h1').textContent,
      章节数: document.querySelectorAll('h2').length,
      正文高度: document.querySelector('.legal-doc').scrollHeight,
      返回链: !!document.querySelector('.legal-back'),
      版权行: document.querySelector('.legal-foot').innerText.includes('路玉宝'),
      横向溢出: document.documentElement.scrollWidth > window.innerWidth,
    }));
    console.log('[法律页]', name, w + 'px', JSON.stringify(info));
    await p2.screenshot({ path: OUT('legal-page-' + name + '.png') });
  }

  await b.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
