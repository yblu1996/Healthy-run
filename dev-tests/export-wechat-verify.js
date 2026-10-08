/**
 * 移动端 PDF 导出回归（无头 Chrome）
 *
 * 背景：微信内置浏览器存不了 blob（下载被拦截、跳外部浏览器开空白 blob: 页面），
 * Web Share 也无可靠实现。2026-09-24 方案：微信 UA 下把 PDF POST 到 /api/export/pdf
 * 换短时真实 URL，微信自带文件预览器打开（右上角菜单可保存/用其他应用打开）；
 * 上传失败才退回页内长图预览。非微信手机浏览器保持 share 优先 + 下载兜底。
 *
 * 四个场景（默认打 3010 临时实例，需先按 dev-tests/README 起服务）：
 *  1) 微信 UA：POST 换 URL 成功 → GET 真实 PDF（200 + application/pdf）→ 不弹长图兜底
 *  2) 微信 UA + 上传被拦（服务端旧版本/故障）：退回页内长图预览
 *  3) 安卓 Chrome + share 抛错：退到 a.download，捕获到 PDF 下载
 *  4) 安卓 Chrome + share 成功：提示"PDF 已分享或保存"，无下载
 *
 * 用法：TEST_BASE=http://127.0.0.1:3010 node dev-tests/export-wechat-verify.js
 */
const path = require('path');
const reportFixture = require('./tmp-verify-payload.json');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3000';
const TOKEN = jwt.sign({ id: 'fbda77bb-4eca-405e-adb0-cd25ada55ecc' }, process.env.JWT_SECRET, { expiresIn: '30m' });
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36';
const WECHAT_UA = ANDROID_UA + ' MicroMessenger/8.0.42';
let failures = 0;

function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!cond) failures++;
}

async function openPage(browser, { ua, shareMode, blockUpload }) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true, userAgent: ua,
  });
  await ctx.addInitScript(({ t, shareMode }) => {
    try { localStorage.setItem('token', t); } catch (e) {}
    if (shareMode) {
      Object.defineProperty(navigator, 'canShare', { value: () => true });
      Object.defineProperty(navigator, 'share', {
        value: () => (shareMode === 'fail'
          ? Promise.reject(new DOMException('denied', 'NotAllowedError'))
          : Promise.resolve()),
      });
    }
  }, { t: TOKEN, shareMode });
  if (blockUpload) {
    // 模拟服务端故障：POST /api/export/pdf 直接 500（不影响 GET）
    await ctx.route('**/api/export/pdf', (route) => route.fulfill({ status: 500, body: '{}' }));
  }
  const p = await ctx.newPage();
  const events = { post: null, pdfGet: null, download: null };
  // 监听必须挂 context：微信场景 PDF 的 GET 发生在 window.open 弹出的新页面里
  ctx.on('response', (r) => {
    const u = r.url();
    if (u.endsWith('/api/export/pdf') && r.request().method() === 'POST') events.post = r.status();
    if (/\/api\/export\/pdf\/[0-9a-f]{64}\.pdf$/.test(u)) events.pdfGet = { status: r.status(), type: r.headers()['content-type'] || '' };
  });
  ctx.on('download', (d) => { events.download = d.suggestedFilename(); });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  await p.evaluate((j) => {
    show('report'); renderReport(j);
    document.querySelector('#reportActions').classList.remove('hidden');
  }, reportFixture);
  return { p, ctx, events };
}

async function clickExportPdf(p) {
  await p.click('#btnExportPdf');
  await p.waitForTimeout(20000);
  // window.open 可能造成页面导航/弹新窗，页面上下文不一定还在；读不到就用 null 占位
  try {
    return await p.evaluate(() => ({
      btnText: document.querySelector('#btnExportPdf').textContent,
      overlayHidden: document.querySelector('#shareOverlay').classList.contains('hidden'),
      toast: document.querySelector('#toast').textContent,
    }));
  } catch { return null; }
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });

  // 1) 微信：服务端换 URL → 打开真实 PDF
  const wechat = await openPage(browser, { ua: WECHAT_UA, shareMode: null, blockUpload: false });
  const wr = await clickExportPdf(wechat.p);
  check('微信: POST 换 URL 成功(200)', wechat.events.post === 200, String(wechat.events.post));
  // 注：无头下浏览器会接管 PDF 响应，Playwright 拿不到它的 headers，
  // 所以这里只断言状态码；Content-Type / 内容一致性由 .pdf-relay-api-check.js 在 API 级证明
  check('微信: GET 到真实 PDF(200)', wechat.events.pdfGet && wechat.events.pdfGet.status === 200, JSON.stringify(wechat.events.pdfGet));
  check('微信: 不弹长图兜底', wr ? wr.overlayHidden === true : true, wr ? '' : '(页面已导航离开)');
  check('微信: 提示可保存', wr ? /PDF/.test(wr.toast) : true, wr ? wr.toast : '');
  await wechat.ctx.close();

  // 2) 微信 + 上传失败：退回长图预览
  const blocked = await openPage(browser, { ua: WECHAT_UA, shareMode: null, blockUpload: true });
  const br = await clickExportPdf(blocked.p);
  check('微信+上传失败: 弹出长图预览', br && br.overlayHidden === false);
  check('微信+上传失败: 按钮恢复', br && br.btnText === '📄 导出 PDF', br ? br.btnText : '');
  check('微信+上传失败: 提示长按保存', br && /长按图片/.test(br.toast), br ? br.toast : '');
  await blocked.ctx.close();

  // 3) 安卓 Chrome：share 失败退到下载
  const fail = await openPage(browser, { ua: ANDROID_UA, shareMode: 'fail', blockUpload: false });
  const fr = await clickExportPdf(fail.p);
  check('安卓+share失败: 触发 PDF 下载', fail.events.download === '跑悟AI跑步报告.pdf', String(fail.events.download));
  check('安卓+share失败: 按钮恢复', fr && fr.btnText === '📄 导出 PDF', fr ? fr.btnText : '');
  await fail.ctx.close();

  // 4) 安卓 Chrome：share 成功
  const ok = await openPage(browser, { ua: ANDROID_UA, shareMode: 'ok', blockUpload: false });
  const or_ = await clickExportPdf(ok.p);
  check('安卓+share成功: 提示已分享', or_ && /已分享或保存/.test(or_.toast), or_ ? or_.toast : '');
  check('安卓+share成功: 无下载', ok.events.download === null, ok.events.download || '');
  await ok.ctx.close();

  await browser.close();
  console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
