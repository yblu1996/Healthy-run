/**
 * 照片垫图重绘 demo：以真实深蹲照片为姿势参考，逐关节精确重绘为极简扁平插画。
 * 产物: public/learn-media/14-squat-ref.svg（不动原文件）
 * 关节坐标按 ref-squat-1.jpg 的人物比例映射到 320x200 画布。
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'public', 'learn-media');

const rad = d => d * Math.PI / 180;
const pt = (x, y) => ({ x, y });
const seg = (p, a, l) => pt(p.x + l * Math.cos(rad(a)), p.y + l * Math.sin(rad(a)));
const f1 = v => v.toFixed(1);
const SPL = '0.42 0 0.58 1';
const track = a => (Array.isArray(a) && (a[0].x !== a[a.length - 1].x || a[0].y !== a[a.length - 1].y)) ? a.concat([a[0]]) : a;

function taperD(a, b, w1, w2) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const A = pt(a.x + nx * w1 / 2, a.y + ny * w1 / 2), B = pt(b.x + nx * w2 / 2, b.y + ny * w2 / 2);
  const C = pt(b.x - nx * w2 / 2, b.y - ny * w2 / 2), E = pt(a.x - nx * w1 / 2, a.y - ny * w1 / 2);
  const cB = pt(b.x + ux * w2 / 2, b.y + uy * w2 / 2), cA = pt(a.x - ux * w1 / 2, a.y - uy * w1 / 2);
  return `M${f1(A.x)} ${f1(A.y)}L${f1(B.x)} ${f1(B.y)}Q${f1(cB.x)} ${f1(cB.y)} ${f1(C.x)} ${f1(C.y)}L${f1(E.x)} ${f1(E.y)}Q${f1(cA.x)} ${f1(cA.y)} ${f1(A.x)} ${f1(A.y)}Z`;
}
function taper(p1, p2, w1, w2, fill, dur) {
  const t1 = Array.isArray(p1) ? track(p1) : null, t2 = Array.isArray(p2) ? track(p2) : null;
  if (t1 && t2 && dur && t1.length === t2.length) {
    return `<path d="${taperD(t1[0], t2[0], w1, w2)}" fill="${fill}"><animate attributeName="d" values="${t1.map((a, i) => taperD(a, t2[i], w1, w2)).join(';')}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(t1.length - 1).fill(SPL).join(';')}"/></path>`;
  }
  return `<path d="${taperD(t1 ? t1[0] : p1, t2 ? t2[0] : p2, w1, w2)}" fill="${fill}"/>`;
}
function joint(p, r, fill, dur) {
  if (!Array.isArray(p)) return `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${r}" fill="${fill}"/>`;
  const t = track(p);
  return `<circle cx="${f1(t[0].x)}" cy="${f1(t[0].y)}" r="${r}" fill="${fill}"><animate attributeName="cx" values="${t.map(q => f1(q.x)).join(';')}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(t.length - 1).fill(SPL).join(';')}"/><animate attributeName="cy" values="${t.map(q => f1(q.y)).join(';')}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(t.length - 1).fill(SPL).join(';')}"/></circle>`;
}
function contour(a0, b0, w) {
  const dx = b0.x - a0.x, dy = b0.y - a0.y, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L * 0.3 * w, ny = dx / L * 0.3 * w;
  const s = pt(a0.x + dx * 0.25 + nx, a0.y + dy * 0.25 + ny);
  const m = pt(a0.x + dx * 0.5 + nx * 1.3, a0.y + dy * 0.5 + ny * 1.3);
  const e = pt(a0.x + dx * 0.75 + nx, a0.y + dy * 0.75 + ny);
  return `<path d="M${f1(s.x)} ${f1(s.y)}Q${f1(m.x)} ${f1(m.y)} ${f1(e.x)} ${f1(e.y)}" fill="none" stroke="#BFE6D2" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>`;
}
function headQ(p, dur, dy) {
  const P = Array.isArray(p) ? p : [p, p];
  const eye = P.map(q => pt(q.x + 5, q.y - 1));
  const hi = P.map(q => pt(q.x - 3, q.y - 3.5));
  return `${joint(P, 10.5, 'url(#headG)', dur)}
  ${joint(eye, 1.8, '#F4FBF7', dur, 0.95)}
  ${joint(hi, 2.6, '#FFFFFF', dur, 0.4)}`;
}
function pill(x, y, text, opts) {
  const o = Object.assign({ fs: 12, anchor: 'start', cls: 'pill-t', W: 320, H: 200, dur: 4.6 }, opts || {});
  let w = 0;
  for (const ch of text) w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF·×✕✓°]/.test(ch) ? o.fs : 0.58 * o.fs;
  w += 22;
  const rxx = Math.max(8, Math.min(o.anchor === 'middle' ? x - w / 2 : x - 10, o.W - w - 8));
  const h = o.fs + 10;
  const ryy = Math.max(6, Math.min(y - o.fs + 1, o.H - h - 2));
  return `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="${o.dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
  <rect x="${f1(rxx)}" y="${f1(ryy)}" width="${f1(w)}" height="${h}" rx="${f1(h / 2)}" fill="#FFFFFF" opacity="0.68" stroke="#FFFFFF" stroke-width="1.2"/>
  <rect x="${f1(rxx)}" y="${f1(ryy)}" width="${f1(w)}" height="${h}" rx="${f1(h / 2)}" fill="none" stroke="#D5E7DE" stroke-width="1" opacity="0.9"/>
  <text x="${x}" y="${y}" text-anchor="${o.anchor}" class="${o.cls}" font-size="${o.fs}">${text}</text></g>`;
}

// ================= 深蹲（照片垫图） =================
// 照片关节 → 画布映射（参照 ref-squat-1.jpg：大腿平行、小腿垂直、臂前平举、送髋后坐）
const dur = 3.4;
// 两相位：A=照片姿势的微浅蹲，B=再深 3px（保持同样形态）
const J = (dy, dx) => ({
  hd: pt(150 + dx * 0.4, 58 + dy),
  sh: pt(131 + dx, 80 + dy),
  hip: pt(110 + dx * 1.2, 112 + dy),
  kN: pt(176 + dx * 0.5, 122 + dy),
  aN: pt(178, 160),
  heel: pt(160, 164), toe: pt(194, 164),
  kF: pt(166 + dx * 0.4, 127 + dy),
  aF: pt(162, 160),
  eN: pt(168 + dx, 84 + dy), hN: pt(205 + dx, 86 + dy),
  eF: pt(171 + dx, 88 + dy), hF: pt(208 + dx, 90 + dy)
});
const A = J(0, 0), B = J(3, -2);
const T = k => [A[k], B[k]];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200" role="img" aria-label="深蹲动作演示（照片垫图重绘）">
<style>text{font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}.lbl{fill:#5F615E;font-size:11px;font-weight:600}.pill-t{fill:#0F6E56;font-size:10.5px;font-weight:700}</style>
<defs>
  <linearGradient id="bgG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDFEFD"/><stop offset="0.6" stop-color="#EEF6F1"/><stop offset="1" stop-color="#E2EEE7"/></linearGradient>
  <radialGradient id="glowG" cx="0.5" cy="0.55" r="0.55"><stop offset="0" stop-color="#C8E8D8" stop-opacity="0.7"/><stop offset="1" stop-color="#C8E8D8" stop-opacity="0"/></radialGradient>
  <linearGradient id="groundG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E3EFE8"/><stop offset="1" stop-color="#D3E4DA"/></linearGradient>
  <linearGradient id="bodyG" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#4D6158"/><stop offset="1" stop-color="#2B3833"/></linearGradient>
  <linearGradient id="bodyFar" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#A4B8AE"/><stop offset="1" stop-color="#7E958A"/></linearGradient>
  <linearGradient id="accG" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#58BD92"/><stop offset="1" stop-color="#2E9C74"/></linearGradient>
  <radialGradient id="headG" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#5C6E65"/><stop offset="1" stop-color="#2B3833"/></radialGradient>
  <radialGradient id="shG" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7FA38F" stop-opacity="0.42"/><stop offset="1" stop-color="#9BBBA9" stop-opacity="0"/></radialGradient>
</defs>
<rect x="0" y="0" width="320" height="200" rx="14" fill="url(#bgG)"/>
<ellipse cx="168" cy="120" rx="118" ry="76" fill="url(#glowG)"><animate attributeName="rx" values="118;126;118" dur="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/><animate attributeName="opacity" values="0.9;1;0.9" dur="4.2s" repeatCount="indefinite"/></ellipse>
<path d="M12 168 Q160 161 308 168 L308 174 Q160 181 12 174 Z" fill="url(#groundG)"/>
<ellipse cx="176" cy="169" rx="48" ry="6.5" fill="url(#shG)">
  <animate attributeName="cx" values="176;172;176" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
  <animate attributeName="rx" values="48;52;48" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
</ellipse>
<g fill="#2FA07C" opacity="0.5">
  <circle cx="52" cy="58" r="3"><animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" dur="5s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
  <circle cx="268" cy="46" r="2.4" fill="#8FCDAE"><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="4.4s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
  <circle cx="288" cy="126" r="3" fill="#D9A648" opacity="0.8"><animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="5.6s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
</g>
<!-- 远侧肢体 -->
${taper(T('eF'), T('hF'), 7.5, 5.5, 'url(#bodyFar)', dur)}
${taper(T('hip'), T('kF'), 13, 9.5, 'url(#bodyFar)', dur)}
${taper(T('kF'), T('aF'), 9.5, 6.5, 'url(#bodyFar)', dur)}
${taper(T('aF'), [pt(180, 165), pt(180, 165)], 6, 4.5, 'url(#bodyFar)', dur)}
${joint(T('kF'), 4.6, 'url(#bodyFar)', dur)}
<!-- 躯干（照片：前倾约 35°，送髋后坐） -->
${taper(T('hip'), T('sh'), 21, 15, 'url(#bodyG)', dur)}
<!-- 近侧肢体 -->
${taper(T('hip'), T('kN'), 16, 12, 'url(#accG)', dur)}
${contour(A.hip, A.kN, 16)}
${taper(T('kN'), T('aN'), 12, 7.5, 'url(#accG)', dur)}
${taper(T('aN'), [T('heel')[0], T('heel')[1]], 8.5, 6, 'url(#accG)', dur)}
${taper(T('aN'), [T('toe')[0], T('toe')[1]], 6, 4.8, 'url(#accG)', dur)}
${joint(T('kN'), 5.2, 'url(#accG)', dur)}
${taper(T('sh'), T('eN'), 9.5, 7, 'url(#bodyG)', dur)}
${taper(T('eN'), T('hN'), 7, 5.4, 'url(#bodyG)', dur)}
${joint(T('eN'), 4, 'url(#bodyG)', dur)}
${joint(T('sh'), 8.5, 'url(#bodyG)', dur)}
${joint(T('hip'), 10.5, 'url(#bodyG)', dur)}
${headQ(T('hd'), dur)}
<!-- 半透明动势线：送髋弧线（平滑曲线，非虚线） -->
<path d="M186 96 Q166 104 152 116" fill="none" stroke="#8FD0B4" stroke-width="3" stroke-linecap="round" opacity="0.5">
  <animate attributeName="opacity" values="0.35;0.6;0.35" dur="${dur}s" repeatCount="indefinite"/>
</path>
${pill(26, 30, '下蹲先送髋：臀部向后坐，不是往前跪', { fs: 12, dur: 4.8 })}
${pill(26, 192, '3 组 × 12-15 次 · 大腿约与地面平行即可', { fs: 12, dur: 5.3 })}
</svg>
`;
fs.writeFileSync(path.join(DIR, '14-squat-ref.svg'), svg);
console.log('14-squat-ref.svg written');
