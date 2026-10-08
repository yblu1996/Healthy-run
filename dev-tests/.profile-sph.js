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
    const rows = [];
    for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x++) { const i = (y*W+x)*4; if (0.299*d[i]+0.587*d[i+1]+0.114*d[i+2] < 190) c++; } rows.push(c); }
    const out = [];
    for (let y = 0; y < H; y += 25) out.push(y + ':' + rows[y]);
    return { W, H, peak: Math.max(...rows), profile: out.join(' ') };
  });
  console.log('尺寸', r.W + 'x' + r.H, '峰值', r.peak);
  console.log(r.profile);
  await b.close();
})();
