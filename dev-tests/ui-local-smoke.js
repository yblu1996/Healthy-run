// 纯本地前端回归：静态文件 + mock API，不访问线上数据库或 AI 服务。
// 用法：node dev-tests/ui-local-smoke.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..', 'public');
const out = path.join(__dirname, '.ui-shots');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': (mime[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});

const records = Array.from({ length: 25 }, (_, i) => ({
  id: `record-${i + 1}`, version: 25 - i, status: 'done', goal: 'none',
  summary: '本周保持轻松跑与规律恢复', created_at: new Date(Date.now() - i * 86400000).toISOString(),
}));
let uploads = 0;
async function mockApi(route) {
  const u = new URL(route.request().url());
  let body;
  if (u.pathname === '/api/auth/me') body = { user: { id: 'runner-1', phone: '13800138000', nickname: '跑者', quota: 3 } };
  else if (u.pathname === '/api/records') {
    const offset = Number(u.searchParams.get('offset') || 0);
    const limit = Number(u.searchParams.get('limit') || 20);
    body = { records: records.slice(offset, offset + limit), total: records.length, has_more: offset + limit < records.length };
  } else if (u.pathname === '/api/trends') {
    body = { series: [
      { version: 1, date: '2026-09-27T01:00:00Z', activity_date: '2026-09-26', weekly_volume_km: null, planned_volume_km: 28, avg_heart_rate: 145 },
      { version: 2, date: '2026-09-30T01:00:00Z', activity_date: '2026-09-30', weekly_volume_km: 31.2, planned_volume_km: 30, avg_heart_rate: null },
    ] };
  } else if (/^\/api\/records\/record-\d+$/.test(u.pathname) && route.request().method() === 'DELETE') {
    const index = records.findIndex((r) => u.pathname.endsWith('/' + r.id));
    if (index >= 0) records.splice(index, 1);
    body = { ok: true };
  } else if (/^\/api\/records\/record-\d+$/.test(u.pathname)) {
    body = { record: { status: 'done', diagnosis: { plan_8_weeks: [] }, recognition: null } };
  } else if (u.pathname === '/api/upload') {
    uploads++;
    await new Promise((resolve) => setTimeout(resolve, 150));
    body = { urls: ['/qrcode-gzh.jpg'] };
  } else body = { error: '未模拟接口：' + u.pathname };
  await route.fulfill({ status: body.error ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body) });
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    fs.mkdirSync(out, { recursive: true });
    const errors = [];
    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await visitor.route('**/api/auth/security-question', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ question: null }),
    }));
    const register = await visitor.newPage();
    register.on('pageerror', (e) => errors.push(e.message));
    await register.goto(base + '/');
    await register.locator('#tabRegister').click();
    assert.equal(await register.locator('#tabRegister').evaluate((el) => el.classList.contains('active')), true);
    await register.locator('#tabLogin').click();
    await register.locator('#forgotLink').click();
    await register.locator('#phone').fill('13800138000');
    await register.locator('#phone').blur();
    await register.waitForFunction(() => document.querySelector('#resetQuestionText').textContent.includes('该账号未设置密保问题'));
    assert.equal(await register.locator('#authSubmit').isDisabled(), true);
    assert.equal(await register.locator('#secaWrap').evaluate((el) => el.classList.contains('hidden')), true);
    await visitor.close();

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => localStorage.setItem('token', 'local-test-token'));
    await context.route('**/api/**', mockApi);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/');
    await page.locator('#view-home.active').waitFor();
    await page.locator('#statGrid .stat-card').first().getByText('25 次').waitFor();
    await page.screenshot({ path: path.join(out, 'local-desktop-home.png'), fullPage: true });

    await page.locator('.nav-links [data-nav="diagnose"]').click();
    await page.locator('#btnNextStep').click();
    assert.equal(await page.locator('#wizPage2').evaluate((el) => el.classList.contains('hidden')), false);
    await page.locator('#consentHealth').check();
    await page.locator('#wizPage2').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(out, 'local-desktop-upload.png'), fullPage: true });

    // 上传控件的 click 不应因隐藏 file input 冒泡而递归；并发上传只发一个请求。
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
    await page.evaluate(async (bytes) => {
      const file = new File([new Uint8Array(bytes)], 'tiny.png', { type: 'image/png' });
      await Promise.all([uploadFiles([file]), uploadFiles([file])]);
    }, Array.from(image));
    assert.equal(uploads, 1);
    assert.equal(await page.locator('#previewGrid .preview-item').count(), 1);
    const tallPreserved = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 600; canvas.height = 5000;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const file = new File([blob], 'long-chart.png', { type: 'image/png' });
      return (await compressImage(file)) === file;
    });
    assert.equal(tallPreserved, true, '长截图不能被压到无法读字的窄图');

    await page.locator('#btnNextStep').click();
    await page.locator('#wizPage1').waitFor({ state: 'visible' });
    await page.locator('#mAge').fill('35');
    await page.screenshot({ path: path.join(out, 'local-desktop-metrics.png'), fullPage: true });

    const report = JSON.parse(fs.readFileSync(path.join(__dirname, 'tmp-verify-payload.json'), 'utf8')).diagnosis_result;
    await page.evaluate((diagnosis_result) => {
      renderReport({ diagnosis_result, recognition: {
        image_type: 'app_screenshot', metrics: { distance_km: 6.57, avg_pace_min_per_km: 6, weekly_volume_km: 31.2 },
        weekly_volume_source: 'dated_week_summary',
        activities: [
          { date: '2026-09-30', metrics: { distance_km: 6.57, duration_min: 39.47 }, source_image_indices: [4] },
          { date: '2026-09-26', metrics: { distance_km: 7.12, avg_heart_rate: 145, cadence_spm: 190 }, source_image_indices: [1, 2, 3],
            splits: [{ segment: 1, distance_km: 1, duration_min: 6.05, avg_pace_min_per_km: 6.05, avg_heart_rate: 138, cadence_spm: 188 }] },
        ],
        period_summaries: [
          { period_type: 'month', period_start: '2026-09-01', period_end: '2026-09-30', distance_km: 112.99, run_count: 16 },
          { period_type: 'week', period_start: '2026-09-21', period_end: '2026-09-27', distance_km: 31.2 },
        ],
      } });
      show('report');
    }, report);
    await page.locator('#card-metrics .activity-detail').first().waitFor();
    assert.equal(await page.locator('#card-metrics .activity-detail').count(), 2);
    await page.locator('#card-metrics .activity-detail').last().locator('summary').click();
    assert.equal(await page.locator('#card-metrics .split-table tbody tr').count(), 1);
    assert.match(await page.locator('#card-metrics').innerText(), /112\.99/);
    assert.match(await page.locator('#card-metrics').innerText(), /截图周汇总跑量/);
    await page.locator('#trendWrap:not(.hidden)').waitFor();
    await page.screenshot({ path: path.join(out, 'local-desktop-report.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    for (const view of ['home', 'diagnose', 'report', 'history', 'learn']) {
      await page.evaluate((name) => show(name), view);
      if (view === 'diagnose') await page.evaluate(() => showWizStep(1));
      if (view === 'history') await page.evaluate(() => loadHistory());
      if (view === 'learn') await page.evaluate(() => loadLearn());
      if (view === 'history') await page.locator('.history-item').first().waitFor();
      if (view === 'learn') await page.locator('.learn-head').first().waitFor();
      await page.locator('#toast').evaluate((el) => el.classList.remove('show'));
      await page.waitForTimeout(350);
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      assert.ok(width.scroll <= width.client, `${view} 横向溢出: ${JSON.stringify(width)}`);
      await page.screenshot({ path: path.join(out, `local-mobile-${view}.png`), fullPage: view !== 'learn' });
    }
    await page.locator('.learn-item').evaluateAll((items) => items.forEach((item) => {
      item.classList.add('open');
      item.querySelector('.learn-head').setAttribute('aria-expanded', 'true');
    }));
    await page.locator('.learn-zoom-trigger img').evaluateAll((images) => images.forEach((img) => { img.loading = 'eager'; }));
    assert.equal(await page.locator('.learn-zoom-trigger img').count(), 18);
    await page.waitForFunction(() => [...document.querySelectorAll('.learn-zoom-trigger img')]
      .every((img) => img.complete && img.naturalWidth === 320), null, { timeout: 10000 });
    await page.locator('.learn-item').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, 'local-mobile-learn-expanded.png') });
    await page.locator('.learn-zoom-trigger').first().click();
    await page.locator('#learnZoomModal').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#learnZoomImage').naturalWidth === 320);
    await page.screenshot({ path: path.join(out, 'local-mobile-learn-zoom.png') });
    await page.keyboard.press('Escape');
    await page.locator('#learnZoomModal').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.learn-zoom-trigger').first().evaluate((el) => document.activeElement === el), true);
    await page.locator('.learn-item').evaluateAll((items) => items.forEach((item) => {
      item.classList.remove('open');
      item.querySelector('.learn-head').setAttribute('aria-expanded', 'false');
    }));
    await page.locator('.learn-head').first().focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.learn-item.open').count(), 1);
    await page.setViewportSize({ width: 320, height: 700 });
    for (const view of ['home', 'diagnose', 'report', 'history', 'learn']) {
      await page.evaluate((name) => show(name), view);
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      assert.ok(width.scroll <= width.client, `${view} 320px 横向溢出: ${JSON.stringify(width)}`);
    }
    await page.locator('.learn-zoom-trigger').first().click();
    const zoomWidth = await page.locator('#learnZoomModal').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    assert.ok(zoomWidth.scroll <= zoomWidth.client, `放大预览 320px 横向溢出: ${JSON.stringify(zoomWidth)}`);
    await page.locator('#learnZoomClose').click();
    await page.evaluate(() => { show('history'); return loadHistory(); });
    await page.locator('.history-item').first().locator('.btn-del').click();
    await page.locator('#confirmOk').click();
    await page.locator('.history-item').first().waitFor();
    await page.locator('#loadMoreBtn').click();
    await page.waitForFunction(() => document.querySelectorAll('.history-item').length === 24);
    assert.equal(await page.locator('[data-id="record-21"]').count(), 1);
    await page.locator('#btnLogout').click();
    await page.locator('#confirmOk').click();
    assert.equal(await page.locator('#consentHealth').isChecked(), false);
    assert.equal(await page.locator('#mAge').inputValue(), '');
    assert.equal(await page.locator('#userText').inputValue(), '');
    assert.equal(await page.locator('#previewGrid .preview-item').count(), 0);
    assert.equal(await page.locator('#password').inputValue(), '');
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS 本地 UI 回归：注册入口、档案统计、表单、上传、报告活动与趋势、18 张动图加载与放大预览、移动端布局、退出授权');
    console.log('截图：' + out);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); server.close(); process.exitCode = 1; });
