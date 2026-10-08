/**
 * PDF 导出问题复现脚本（无头 Chrome，不依赖浏览器扩展）
 *
 * 用真实的模型产出的报告渲染报告页，然后点击「导出 PDF」，捕获：
 *  - 控制台报错 / 未捕获异常
 *  - canvas 尺寸、dataURL 长度（html2canvas 是否被撑爆）
 *  - PDF Blob 体积、是否真的触发下载
 *
 * 用法：node dev-tests/pdf-export-repro.js
 */
const path = require('path');
const fs = require('fs');
const reportFixture = require('./tmp-verify-payload.json');
const { chromium } = require('playwright-core');

const BROWSER = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:3000';

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const logs = [];
  page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(BASE + '/', { waitUntil: 'load' });

  // 注入真实报告数据并渲染（token 仅用于绕过登录，报告页渲染本身不校验）
  const injected = await page.evaluate((p) => {
    window.__p = p;
    show('report');
    renderReport(p);
    return {
      weeks: (p.diagnosis_result.plan_8_weeks || []).length,
      diags: (p.diagnosis_result.diagnosis || []).length,
    };
  }, reportFixture);
  console.log('注入报告：', JSON.stringify(injected));

  // 先单独量一次 captureReport，拿到 canvas 真实尺寸
  const canvasInfo = await page.evaluate(async () => {
    try {
      const el = document.querySelector('#reportBody');
      const t0 = performance.now();
      const c = await captureReport('量测中…');
      const ms = Math.round(performance.now() - t0);
      let dataLen = 0, dataErr = null;
      try { dataLen = c.toDataURL('image/jpeg', 0.92).length; } catch (e) { dataErr = e.message; }
      return { cssHeight: el.offsetHeight, w: c.width, h: c.height, ms, dataLen, dataErr };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('captureReport：', JSON.stringify(canvasInfo));

  // 再走真实的「导出 PDF」按钮
  let downloadInfo = 'no-download';
  const dlPromise = page.waitForEvent('download', { timeout: 45000 }).catch(() => null);
  await page.click('#btnExportPdf');
  const dl = await dlPromise;
  if (dl) {
    const p = path.join(__dirname, '.pdf-out.pdf');
    await dl.saveAs(p);
    downloadInfo = { name: dl.suggestedFilename(), bytes: fs.statSync(p).size, path: p };
  }
  console.log('下载结果：', JSON.stringify(downloadInfo));

  // 等 toast 出现，看前端给了什么提示
  const toast = await page.evaluate(() => {
    const t = document.querySelector('#toast');
    return { text: t.textContent, show: t.classList.contains('show') };
  });
  console.log('前端提示：', JSON.stringify(toast));

  console.log('\n--- 浏览器日志 ---');
  logs.slice(-25).forEach((l) => console.log('  ' + l));

  await browser.close();
})().catch((e) => { console.error('脚本异常：', e.message); process.exit(1); });
