/**
 * 定位 pdf/长图导出的 addColorStop non-finite 崩溃来源
 * 用法：node dev-tests/pdf-grad-probe.js
 */
const { chromium } = require('playwright-core');
const reportFixture = require('./tmp-verify-payload.json');
const BROWSER = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'load' });

  const out = await page.evaluate(async (p) => {
    show('report');
    renderReport(p);
    const el = document.querySelector('#reportBody');
    const res = {};

    // 1) 先看水印页脚自身的几何与计算样式
    let footer = null;
    try {
      footer = await buildWatermarkFooter();
      el.appendChild(footer);
      const cs = getComputedStyle(footer);
      const r = footer.getBoundingClientRect();
      res.footer = {
        cls: footer.className,
        rectW: r.width, rectH: r.height,
        offsetW: footer.offsetWidth, offsetH: footer.offsetHeight,
        background: cs.backgroundImage,
        display: cs.display, flexDirection: cs.flexDirection,
        childCount: footer.children.length,
      };
      res.footerChildren = [...footer.querySelectorAll('*')].slice(0, 12).map((c) => {
        const b = c.getBoundingClientRect();
        return { tag: c.tagName, cls: c.className, w: Math.round(b.width), h: Math.round(b.height), bg: getComputedStyle(c).backgroundImage.slice(0, 40) };
      });
    } catch (e) {
      res.footerBuildError = e.message;
    }

    await loadScript('./vendor/html2canvas.min.js');

    // 2) 带水印截图（当前线上行为）
    try {
      await html2canvas(el, { scale: 1, backgroundColor: '#F6F8F7', useCORS: true });
      res.withFooter = 'OK';
    } catch (e) { res.withFooter = 'FAIL: ' + e.message; }

    // 3) 把水印的渐变换成纯色后再截
    if (footer) footer.style.backgroundImage = 'none', footer.style.background = '#0F6E56';
    try {
      await html2canvas(el, { scale: 1, backgroundColor: '#F6F8F7', useCORS: true });
      res.flatFooter = 'OK';
    } catch (e) { res.flatFooter = 'FAIL: ' + e.message; }

    // 4) 完全移除水印后再截（对照组）
    if (footer && footer.parentNode) footer.remove();
    try {
      const c = await html2canvas(el, { scale: 1, backgroundColor: '#F6F8F7', useCORS: true });
      res.noFooter = `OK ${c.width}x${c.height}`;
    } catch (e) { res.noFooter = 'FAIL: ' + e.message; }

    return res;
  }, reportFixture);

  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error('异常：', e.message); process.exit(1); });
