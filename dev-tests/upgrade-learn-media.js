/**
 * 批量升级学习园地矢量图（18 张）
 * - 场景层：浅绿渐变背景 + 呼吸光斑 + 地面 + 呼吸影子 + 漂浮粒子（与程序青绿色系协调）
 * - 人物层：近侧肢体加粗为深青灰渐变、远侧肢体浅色制造纵深、头部高光
 * - 教学层：引导线/标注统一为品牌青绿，文字包进悬浮玻璃胶囊
 * - 保留全部 SMIL 动作动画与教学内容；原文件备份到 learn-media/originals/
 * 用法: node upgrade-learn-media.js
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'learn-media');
const BACKUP = path.join(DIR, 'originals');
const SKIP = new Set(['14-squat-v2.svg']);

// —— 程序色系（style.css）——
// teal #0F6E56 / teal-dark #085041 / teal-light #E1F5EE / bg #F6F8F7 / text #1F2421 / amber #B7791F / red #C0392B

const STYLE_NEW = `<style>text{font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}.lbl{fill:#5F615E;font-size:11px;font-weight:600}.pill-t{fill:#0F6E56;font-size:10.5px;font-weight:700}</style>`;

function sceneBlock(groundY, cx, W, H) {
  const gy = groundY;
  return `
  <defs>
    <linearGradient id="bgG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FDFEFD"/>
      <stop offset="0.6" stop-color="#EEF6F1"/>
      <stop offset="1" stop-color="#E2EEE7"/>
    </linearGradient>
    <radialGradient id="glowG" cx="0.5" cy="0.55" r="0.55">
      <stop offset="0" stop-color="#BFE5D4" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#BFE5D4" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bodyG" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175">
      <stop offset="0" stop-color="#42524B"/>
      <stop offset="1" stop-color="#232E29"/>
    </linearGradient>
    <linearGradient id="bodyFar" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175">
      <stop offset="0" stop-color="#93A89D"/>
      <stop offset="1" stop-color="#667C71"/>
    </linearGradient>
    <radialGradient id="headHi" cx="0.35" cy="0.3" r="0.9">
      <stop offset="0" stop-color="#5A6A62"/>
      <stop offset="1" stop-color="#232E29"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="url(#bgG)"/>
  <ellipse cx="${cx}" cy="${Math.round(gy - 45)}" rx="118" ry="76" fill="url(#glowG)">
    <animate attributeName="rx" values="118;126;118" dur="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>
    <animate attributeName="opacity" values="0.9;1;0.9" dur="4.2s" repeatCount="indefinite"/>
  </ellipse>
  <path d="M12 ${gy} Q160 ${gy - 7} 308 ${gy} L308 ${gy + 6} Q160 ${gy + 13} 12 ${gy + 6} Z" fill="#DCE9E2" opacity="0.9"/>
  <ellipse cx="${cx}" cy="${gy - 2}" ry="5.5" fill="#B9CDC2" opacity="0.45">
    <animate attributeName="rx" values="46;37;46" dur="2.8s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>
    <animate attributeName="opacity" values="0.45;0.3;0.45" dur="2.8s" repeatCount="indefinite"/>
  </ellipse>
  <g fill="#2FA07C" opacity="0.6">
    <circle cx="52" cy="58" r="3">
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" dur="5s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>
    </circle>
    <circle cx="268" cy="46" r="2.4" fill="#8FCDAE">
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="4.4s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>
    </circle>
    <circle cx="288" cy="126" r="3.2" fill="#D9A648" opacity="0.8">
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="5.6s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>
    </circle>
    <circle cx="40" cy="122" r="2.2" fill="#8FCDAE">
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="4.8s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>
    </circle>
  </g>`;
}

function textWidth(s, fs) {
  let w = 0;
  for (const ch of s.replace(/<[^>]+>/g, '')) {
    if (ch === ' ') w += 0.32 * fs;
    else if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF·×]/.test(ch)) w += fs;
    else w += 0.58 * fs;
  }
  return w;
}

function wrapTextInPill(match, fileIdx, textIdx, W, H) {
  // match: <text x.. y.. fill.. font-size.. text-anchor.. font-weight..>content</text>
  const attrs = match.match(/<text([^>]*)>/)[1];
  const content = match.replace(/<text[^>]*>/, '').replace(/<\/text>\s*$/, '');
  const num = (name, dflt) => {
    const m = attrs.match(new RegExp(name + '="([\\d.]+)"'));
    return m ? parseFloat(m[1]) : dflt;
  };
  const x = num('x', 160), y = num('y', 100), fs = num('font-size', 12);
  const anchor = (attrs.match(/text-anchor="(\w+)"/) || [])[1] || 'start';
  let w = textWidth(content, fs) + 22;
  w = Math.min(w, 300);
  let rx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w + 10 : x - 10;
  rx = Math.max(8, Math.min(rx, W - w - 8));
  const h = fs + 10;
  let ry = Math.min(y - fs + 1, H - h - 2);
  ry = Math.max(6, ry);
  const dur = (4.2 + textIdx * 0.5 + (fileIdx % 3) * 0.3).toFixed(1);
  const isTip = /#0F6E56|#2F8F6B/.test(attrs) || /600|700/.test(attrs);
  const cls = isTip ? 'pill-t' : 'lbl';
  const fsAttr = attrs.match(/font-size="[\d.]+"/) ? '' : ` font-size="12"`;
  return `  <g>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>
    <rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="${(h / 2).toFixed(1)}" fill="#FFFFFF" opacity="0.66" stroke="#FFFFFF" stroke-width="1.2"/>
    <rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="${(h / 2).toFixed(1)}" fill="none" stroke="#D5E7DE" stroke-width="1" opacity="0.9"/>
    <text x="${x}" y="${y}"${fsAttr} text-anchor="${anchor}" class="${cls}">${content}</text>
  </g>`;
}

function upgrade(name, fileIdx) {
  const file = path.join(DIR, name);
  let s = fs.readFileSync(file, 'utf8');

  // 校验画布
  const vb = s.match(/viewBox="([^"]+)"/);
  if (!vb || !/^0 0 \d+ \d+$/.test(vb[1])) return { name, ok: false, reason: 'viewBox=' + (vb && vb[1]) };
  const [W, H] = vb[1].split(' ').slice(2).map(Number);

  // 地面线 y；多条地面线 = 多格对比图 → 轻量场景（只加背景，不加光斑/地面/影子）
  const groundLines = s.match(/<line x1="24" y1="(\d+)" x2="296" y2="\d+" stroke="#D5E0DA"/g) || [];
  const light = groundLines.length > 1;
  const gm = groundLines[0] && groundLines[0].match(/y1="(\d+)"/);
  const groundY = gm ? parseInt(gm[1], 10) : 170;

  // 人物重心 x：所有深色肢体坐标均值
  const xs = [];
  for (const m of s.matchAll(/<(?:line|circle)[^>]*(?:x1|x2|cx)="([\d.]+)"[^>]*(?:#33413A)/g)) xs.push(parseFloat(m[1]));
  for (const m of s.matchAll(/#33413A[^>]*?(?:x1|x2|cx)="([\d.]+)"/g)) xs.push(parseFloat(m[1]));
  const cx = xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 160;

  // 1) 替换 style
  s = s.replace(/<style>[\s\S]*?<\/style>/, STYLE_NEW);

  // 2) 场景插入到 </style> 之后（多格对比图用轻量场景）
  const scene = light
    ? sceneBlock(groundY, cx, W, H).split(/<rect x="0" y="0"/)[0] + `\n  <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="url(#bgG)"/>`
    : sceneBlock(groundY, cx, W, H);
  s = s.replace(/<\/style>/, '</style>\n' + scene);

  // 3) 肢体升级：远侧(浅) / 近侧(深)，加粗
  let farCount = 0, nearCount = 0;
  s = s.replace(/<line([^>]*)stroke="#33413A"([^>]*)\/?>([\s\S]*?)(?=<line|<circle|<path|<text|<\/svg>|$)/g, (m, pre, post) => {
    const attrs = pre + post;
    const op = parseFloat((attrs.match(/opacity="([\d.]+)"/) || [])[1] || '1');
    const sw = parseFloat((attrs.match(/stroke-width="([\d.]+)"/) || [])[1] || '5');
    const isFar = op < 0.5;
    if (isFar) farCount++; else nearCount++;
    const newSw = Math.min(13, sw + (isFar ? 4.5 : 5));
    const grad = isFar ? 'url(#bodyFar)' : 'url(#bodyG)';
    const newOp = isFar ? ' opacity="0.55"' : (attrs.includes('opacity') ? ' opacity="1"' : '');
    let head = m.match(/^[^>]*/)[0];
    head = head.replace(/stroke="#33413A"/, `stroke="${grad}"`)
               .replace(/stroke-width="[\d.]+"/, `stroke-width="${newSw}"`);
    // 移除/改写原 opacity（防止和渐变叠加过淡）
    if (isFar) head = head.replace(/opacity="[\d.]+"/, 'opacity="0.55"');
    else if (head.includes('opacity=')) head = head.replace(/opacity="[\d.]+"/, 'opacity="1"');
    return m.replace(/^[^>]*/, head);
  });

  // 4) 圆：头部(大圆高光) / 小圆(节奏点改青绿)
  let headCount = 0, dotCount = 0;
  s = s.replace(/<circle([^>]*)fill="#33413A"([^>]*)>([\s\S]*?)<\/circle>/g, (m, pre, post, inner) => {
    const attrs = pre + post;
    const r = parseFloat((attrs.match(/ r="([\d.]+)"/) || [])[1] || '0');
    if (r >= 6) {
      headCount++;
      const head = m.replace(/fill="#33413A"/, 'fill="url(#headHi)"')
                    .replace(/ r="[\d.]+"/, ` r="${(r + 1).toFixed(1)}"`);
      // 高光点：复制 cx/cy 动画（偏移 -3,-3），无动画则静态
      const aniCx = inner.match(/<animate attributeName="cx"[\s\S]*?\/>/);
      const aniCy = inner.match(/<animate attributeName="cy"[\s\S]*?\/>/);
      const cxv = (attrs.match(/cx="([\d.]+)"/) || [])[1];
      const cyv = (attrs.match(/cy="([\d.]+)"/) || [])[1];
      let hi = `<circle cx="${(parseFloat(cxv) - 3).toFixed(1)}" cy="${(parseFloat(cyv) - 3).toFixed(1)}" r="2.6" fill="#FFFFFF" opacity="0.45" pointer-events="none">`;
      if (aniCx) hi += aniCx[0].replace(/values="([^"]+)"/, (mm, vals) => {
        const parts = vals.split(';').map(v => (parseFloat(v) - 3).toFixed(1));
        return `values="${parts.join(';')}"`;
      });
      if (aniCy) hi += aniCy[0].replace(/values="([^"]+)"/, (mm, vals) => {
        const parts = vals.split(';').map(v => (parseFloat(v) - 3).toFixed(1));
        return `values="${parts.join(';')}"`;
      });
      hi += '</circle>';
      return head + hi;
    }
    dotCount++;
    return m.replace(/fill="#33413A"/, 'fill="#0F6E56"').replace(/ r="/, ' opacity="0.6" r="');
  });

  // 5) 全局换色（旧 → 程序色系）
  s = s
    .replace(/#2F8F6B/g, '#0F6E56')
    .replace(/#D0533F/g, '#C0392B')
    .replace(/#7E8C85/g, '#5F615E')
    .replace(/#AFC5BA/g, '#A8C6B8')
    .replace(/stroke="#D5E0DA"/g, 'stroke="#C6D9CF"');

  // 6) 文字 → 悬浮玻璃胶囊
  let ti = 0;
  s = s.replace(/<text[^>]*>[\s\S]*?<\/text>/g, m => wrapTextInPill(m, fileIdx, ti++, W, H));

  // 7) aria-label 兜底
  s = s.replace('aria-label="undefined"', `aria-label="学习园地动作演示"`);

  fs.writeFileSync(file, s);
  return { name, ok: true, groundY, cx, farCount, nearCount, headCount, dotCount, pills: ti };
}

// —— 备份 + 执行 ——
if (!fs.existsSync(BACKUP)) fs.mkdirSync(BACKUP);
const argFiles = process.argv.slice(2);
const files = argFiles.length
  ? argFiles
  : fs.readdirSync(DIR).filter(f => /^([\d]+)-.*\.svg$/.test(f) && !SKIP.has(f) && !fs.existsSync(path.join(BACKUP, f)));
files.forEach(f => fs.copyFileSync(path.join(DIR, f), path.join(BACKUP, f)));
const results = files.map((f, i) => upgrade(f, i));
for (const r of results) {
  console.log(r.ok
    ? `${r.name}: OK groundY=${r.groundY} cx=${r.cx} near=${r.nearCount} far=${r.farCount} head=${r.headCount} dot=${r.dotCount} pills=${r.pills}`
    : `${r.name}: SKIP (${r.reason})`);
}
console.log(`\n${results.filter(r => r.ok).length}/${results.length} upgraded. Backups in learn-media/originals/`);
