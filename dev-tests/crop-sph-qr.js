/**
 * 视频号二维码裁切：原始图是 1060x1377 的竖版卡片（上方标题块、下方关注语），
 * 直接塞进方形展示位会被压扁。这里找出二维码的实际包围盒，裁成正方形。
 *
 * 判据说明：这是"艺术二维码"，二维码主体由稀疏点线构成，用"深色像素"做判据会漏掉大片区域
 * （实测暗像素判据会把标题行算进来、把二维码本体的中间行漏掉）。改用"非白像素"（亮度 < 245），
 * 并把扫描范围限制在中间区域，避开上方标题与下方关注语，实测得到 720x722 的稳定方框。
 *
 * 产出：public/qrcode-sph-square.jpg
 * 用法：node dev-tests/crop-sph-qr.js [--dry]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BROWSER = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SRC = 'qrcode-sph.jpg';
const DEST = 'public/qrcode-sph-square.jpg';
const DRY = process.argv.includes('--dry');

(async () => {
  const browser = await chromium.launch({ executablePath: BROWSER, headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto('http://127.0.0.1:3000/');

  const box = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = '/' + src;
    await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const luma = (x, y) => { const i = (y * W + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
    const y0 = Math.round(H * 0.23), y1 = Math.round(H * 0.87);
    let xa = -1, xb = -1, ya = -1, yb = -1;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < W; x++) {
        if (luma(x, y) < 245) {
          if (xa < 0 || x < xa) xa = x;
          if (x > xb) xb = x;
          if (ya < 0) ya = y;
          yb = y;
        }
      }
    }
    return { W, H, xa, xb, ya, yb, scan: [y0, y1] };
  }, SRC);

  console.log('源图:', box.W + 'x' + box.H, '| 扫描行段', box.scan.join('-'));
  console.log('非白包围盒: x', box.xa, '→', box.xb, '(宽', box.xb - box.xa + 1 + ')', '| y', box.ya, '→', box.yb, '(高', box.yb - box.ya + 1 + ')');

  const cx = (box.xa + box.xb) / 2;
  const cy = (box.ya + box.yb) / 2;
  const side = Math.max(box.xb - box.xa, box.yb - box.ya) + 56; // 四周各留 28px 白边
  const sx = Math.round(Math.max(0, Math.min(box.W - side, cx - side / 2)));
  const sy = Math.round(Math.max(0, Math.min(box.H - side, cy - side / 2)));
  console.log('裁切: 边长', side, '| 起点 x=' + sx, 'y=' + sy);

  if (DRY) { await browser.close(); return console.log('[dry] 未写文件'); }

  const dataUrl = await page.evaluate(async ({ src, sx, sy, side }) => {
    const img = new Image();
    img.src = '/' + src;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = side; cv.height = side;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, side, side);              // 先铺白底，裁切边缘不留透明
    g.drawImage(img, sx, sy, side, side, 0, 0, side, side);
    return cv.toDataURL('image/jpeg', 0.95);
  }, { src: SRC, sx, sy, side });

  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(__dirname, '..', DEST), buf);
  console.log('已写出', DEST, Math.round(buf.length / 1024) + 'KB');

  // 预览图，便于肉眼核对裁切是否完整
  const png = await page.evaluate(async (d) => {
    const img = new Image(); img.src = d; await img.decode();
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 320;
    cv.getContext('2d').drawImage(img, 0, 0, 320, 320);
    return cv.toDataURL('image/png');
  }, dataUrl);
  const prev = path.join(__dirname, '.ui-shots', 'sph-square-preview.png');
  fs.mkdirSync(path.dirname(prev), { recursive: true });
  fs.writeFileSync(prev, Buffer.from(png.split(',')[1], 'base64'));
  console.log('预览:', prev);

  await browser.close();
})().catch((e) => { console.error('异常：', e.message); process.exit(1); });
