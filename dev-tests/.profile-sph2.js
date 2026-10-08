const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const p = await (await b.newContext()).newPage();
  await p.goto('http://127.0.0.1:3000/');
  const r = await p.evaluate(async () => {
    const img = new Image(); img.src = '/qrcode-sph.jpg'; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, W, H).data;
    const luma = (x, y) => { const i = (y*W+x)*4; return 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; };
    const res = {};
    for (const [name, t, y0, y1] of [['lt235 y320-1200', 235, 320, 1200], ['lt245 y320-1200', 245, 320, 1200], ['lt250 y320-1200', 250, 320, 1200]]) {
      let xa = -1, xb = -1, ya = -1, yb = -1;
      for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (luma(x, y) < t) { if (xa < 0 || x < xa) xa = x; if (x > xb) xb = x; if (ya < 0) ya = y; yb = y; }
      res[name] = { x: [xa, xb], y: [ya, yb], w: xb-xa+1, h: yb-ya+1 };
    }
    // 顺带看四角与边中点的亮度，判断有没有浅色边框
    res.corners = { tl: Math.round(luma(5,5)), c: Math.round(luma(530, 60)), edge: Math.round(luma(5, 700)), mid: Math.round(luma(530, 1200)) };
    return res;
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
