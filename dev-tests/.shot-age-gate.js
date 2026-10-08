// 年龄门槛的真机核对：诊断页第 1 步「年龄」输入框在 12 岁时应被判为非法，
// 并读出浏览器给出的校验文案（证明前端 min=14 真的生效，而不是只改了 HTML 里的数字）。
// 用真实 user_id 自签 JWT 走登录态，与 .shot-account.js 同一套路。
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright-core');

const OUT = path.join(__dirname, '.ui-shots');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { data: u } = await sb.from('users').select('id').limit(1).maybeSingle();
  if (!u) throw new Error('库里没有可用的 user_id，无法构造登录态');

  const token = jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: '30m' });
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });

  for (const [label, vp] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'zh-CN' });
    await ctx.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, token);
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:3000/', { waitUntil: 'load' });
    await page.waitForTimeout(2000); // 等 bootstrap() 的 /auth/me 回来，否则视图会被顶掉

    await page.evaluate(() => window.show('diagnose'));
    await page.waitForTimeout(400);

    // 12 岁：应非法；45 岁：应合法
    const probe = await page.evaluate(() => {
      const el = document.querySelector('#mAge');
      const check = (v) => {
        el.value = v;
        return { value: v, valid: el.checkValidity(), min: el.min, max: el.max, msg: el.validationMessage };
      };
      return { bad: check('12'), good: check('45') };
    });

    console.log(`\n[${label}] 年龄输入框 min=${probe.bad.min} max=${probe.bad.max}`);
    console.log(`  填 12 → 合法? ${probe.bad.valid}｜提示：「${probe.bad.msg}」`);
    console.log(`  填 45 → 合法? ${probe.good.valid}`);

    // 截图：把非法值留在框里，并触发一次原生校验气泡位置（用 reportValidity 让浏览器标红）
    await page.evaluate(() => {
      const el = document.querySelector('#mAge');
      el.value = '12';
      el.reportValidity();
    });
    await page.waitForTimeout(300);
    const shot = path.join(OUT, `age-gate-${label}.png`);
    await page.screenshot({ path: shot });
    console.log('  截图 ->', shot);
    await ctx.close();
  }

  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
