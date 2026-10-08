/**
 * 导出功能端到端验证（无头 Chrome，不依赖浏览器扩展）
 *
 * 用真实模型产出的报告渲染报告页，然后分别点「生成长图」和「导出 PDF」，检查：
 *  - 是否捕获到异常（历史故障：水印渐变触发 addColorStop non-finite）
 *  - canvas 实际尺寸、JPEG/PNG dataURL 长度
 *  - 下载是否真的发生、文件体积、PDF 魔数与页数
 *
 * 用法：node dev-tests/export-verify.js
 */
const path = require('path');
const fs = require('fs');
const reportFixture = require('./tmp-verify-payload.json');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright-core');

const BROWSER = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, '.export-out');
// renderReport 会顺带拉趋势图（loadTrends），没有有效令牌会被 401 踢回登录页，
// 报告视图随之隐藏、量不到高度。所以先签一个真令牌塞进 localStorage。
const UID = process.env.VERIFY_UID || 'fbda77bb-4eca-405e-adb0-cd25ada55ecc';
const TOKEN = jwt.sign({ id: UID }, process.env.JWT_SECRET, { expiresIn: '30m' });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, TOKEN);
  const page = await ctx.newPage();

  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(BASE + '/', { waitUntil: 'load' });
  // 等 bootstrap() 的 /auth/me 回来并切到首页视图，否则它随后会 show('home')
  // 把刚切好的报告页顶掉，按钮就"不可见"了
  await page.waitForTimeout(2000);
  const injected = await page.evaluate((p) => {
    show('report');
    renderReport(p);
    document.querySelector('#reportActions').classList.remove('hidden');
    return { weeks: (p.diagnosis_result.plan_8_weeks || []).length, diags: (p.diagnosis_result.diagnosis || []).length };
  }, reportFixture);
  console.log('报告已渲染：', JSON.stringify(injected));

  // 1) 直接量 captureReport：报告高度 / 画布尺寸 / 编码长度
  const cap = await page.evaluate(async () => {
    const el = document.querySelector('#reportBody');
    const cssH = el.offsetHeight;
    const t0 = performance.now();
    try {
      const c = await captureReport('量测中…');
      const ms = Math.round(performance.now() - t0);
      const jpg = c.toDataURL('image/jpeg', 0.92).length;
      const png = c.toDataURL('image/png').length;
      return { cssH, w: c.width, h: c.height, ms, jpgKB: Math.round(jpg / 1024), pngKB: Math.round(png / 1024), err: null };
    } catch (e) {
      return { cssH, err: e.message };
    }
  });
  console.log('captureReport：', JSON.stringify(cap));

  // 2) 真实点击「生成长图」
  const grab = async (selector, file) => {
    const dlP = page.waitForEvent('download', { timeout: 90000 }).catch(() => null);
    await page.click(selector);
    const dl = await dlP;
    if (!dl) return { clicked: selector, download: false, toast: await readToast() };
    const p = path.join(OUT, file);
    await dl.saveAs(p);
    return { clicked: selector, download: true, name: dl.suggestedFilename(), kb: Math.round(fs.statSync(p).size / 1024), path: p };
  };
  const readToast = () => page.evaluate(() => {
    const t = document.querySelector('#toast');
    return { text: t.textContent, show: t.classList.contains('show') };
  });

  const img = await grab('#btnExportImage', 'report.png');
  console.log('生成长图：', JSON.stringify(img));

  const pdf = await grab('#btnExportPdf', 'report.pdf');
  console.log('导出 PDF：', JSON.stringify(pdf));

  // 3) PDF 结构校验：魔数 + 页数
  if (pdf.download) {
    const buf = fs.readFileSync(pdf.path);
    const head = buf.slice(0, 8).toString('latin1');
    const text = buf.toString('latin1');
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    console.log('PDF 校验：', JSON.stringify({ magic: head.trim(), valid: head.startsWith('%PDF-'), pages, totalKB: Math.round(buf.length / 1024) }));
  }

  // 4) PNG 尺寸校验
  if (img.download) {
    const b = fs.readFileSync(img.path);
    console.log('PNG 校验：', JSON.stringify({ w: b.readUInt32BE(16), h: b.readUInt32BE(20), valid: b.slice(1, 4).toString() === 'PNG' }));
  }

  console.log('\n--- 浏览器警告/错误 ---');
  (logs.length ? logs : ['(无)']).slice(-12).forEach((l) => console.log('  ' + l));

  await browser.close();
})().catch((e) => { console.error('脚本异常：', e.message); process.exit(1); });
