/**
 * 学习园地矢量图 v3：极简扁平运动插画风
 * - 锥形变宽肢体（填充路径）+ 圆润关节 + 肌肉轮廓线 + 渐变体积
 * - 3/4 斜侧视角（远侧肢体偏移+浅色）
 * - 柔和接触阴影（径向渐变），动势=半透明平滑曲线（无生硬虚线）
 * - 薄荷绿运动色系
 * 用法: node figures-v3.js [文件名...]  无参数=全部 18 张
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'public', 'learn-media');

const rad = d => d * Math.PI / 180;
const pt = (x, y) => ({ x, y });
const seg = (p, a, len) => pt(p.x + len * Math.cos(rad(a)), p.y + len * Math.sin(rad(a)));
const f1 = v => v.toFixed(1);
const SPL = '0.42 0 0.58 1';
// 轨道自动闭合（A;B → A;B;A 循环不跳变）
const track = a => (Array.isArray(a) && a.length > 1 && (a[0].x !== a[a.length - 1].x || a[0].y !== a[a.length - 1].y)) ? a.concat([a[0]]) : a;

const NEAR = 'url(#bodyG)', FAR = 'url(#bodyFar)', ACC = 'url(#accG)', HEAD = 'url(#headG)';
const TEAL = '#3FA982', MINT = '#8FD0B4', RED = '#C0392B', REDN = 'url(#redG)';

/* ---- 锥形肢体：两端宽度不同、圆头、可动画 ---- */
function taper(p1, p2, w1, w2, fill, dur) {
  const D = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const A = pt(a.x + nx * w1 / 2, a.y + ny * w1 / 2), B = pt(b.x + nx * w2 / 2, b.y + ny * w2 / 2);
    const C = pt(b.x - nx * w2 / 2, b.y - ny * w2 / 2), E = pt(a.x - nx * w1 / 2, a.y - ny * w1 / 2);
    const cB = pt(b.x + ux * w2 / 2, b.y + uy * w2 / 2), cA = pt(a.x - ux * w1 / 2, a.y - uy * w1 / 2);
    return `M${f1(A.x)} ${f1(A.y)}L${f1(B.x)} ${f1(B.y)}Q${f1(cB.x)} ${f1(cB.y)} ${f1(C.x)} ${f1(C.y)}L${f1(E.x)} ${f1(E.y)}Q${f1(cA.x)} ${f1(cA.y)} ${f1(A.x)} ${f1(A.y)}Z`;
  };
  const t1 = track(Array.isArray(p1) ? p1 : null), t2 = Array.isArray(p2) ? track(p2) : null;
  if (t1 && t2 && dur && t1.length === t2.length) {
    const vals = t1.map((a, i) => D(a, t2[i])).join(';');
    return `<path d="${D(t1[0], t2[0])}" fill="${fill}"><animate attributeName="d" values="${vals}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(t1.length - 1).fill(SPL).join(';')}"/></path>`;
  }
  if (t1 && !t2 && dur) { // p2 静态
    const vals = t1.map(a => D(a, p2)).join(';');
    return `<path d="${D(t1[0], p2)}" fill="${fill}"><animate attributeName="d" values="${vals}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(t1.length - 1).fill(SPL).join(';')}"/></path>`;
  }
  return `<path d="${D(Array.isArray(p1) ? p1[0] : p1, Array.isArray(p2) ? p2[0] : p2)}" fill="${fill}"/>`;
}

/* ---- 圆润关节 ---- */
function joint(p, r, fill, dur, op) {
  if (!Array.isArray(p)) return `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${r}" fill="${fill}"${op ? ` opacity="${op}"` : ''}/>`;
  const t = track(p);
  const cx = t.map(q => f1(q.x)).join(';'), cy = t.map(q => f1(q.y)).join(';');
  return `<circle cx="${f1(t[0].x)}" cy="${f1(t[0].y)}" r="${r}" fill="${fill}"${op ? ` opacity="${op}"` : ''}><animate attributeName="cx" values="${cx}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(t.length - 1).fill(SPL).join(';')}"/><animate attributeName="cy" values="${cy}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(t.length - 1).fill(SPL).join(';')}"/></circle>`;
}

/* ---- 肌肉轮廓线（沿肢体的柔和高光弧） ---- */
function contour(p1, p2, w, dur, off) {
  const offd = off || 0.28;
  const D = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L * offd * w, ny = dx / L * offd * w;
    const s = pt(a.x + dx * 0.22 + nx, a.y + dy * 0.22 + ny);
    const m = pt(a.x + dx * 0.5 + nx * 1.35, a.y + dy * 0.5 + ny * 1.35);
    const e = pt(a.x + dx * 0.78 + nx, a.y + dy * 0.78 + ny);
    return `M${f1(s.x)} ${f1(s.y)}Q${f1(m.x)} ${f1(m.y)} ${f1(e.x)} ${f1(e.y)}`;
  };
  const t1 = Array.isArray(p1) ? track(p1) : null, t2 = Array.isArray(p2) ? track(p2) : null;
  const st = window0 => window0;
  const d0 = D(t1 ? t1[0] : p1, t2 ? t2[0] : p2);
  if (t1 && t2 && dur && t1.length === t2.length) {
    return `<path d="${d0}" fill="none" stroke="#BFE6D2" stroke-width="1.6" stroke-linecap="round" opacity="0.35"><animate attributeName="d" values="${t1.map((a, i) => D(a, t2[i])).join(';')}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(t1.length - 1).fill(SPL).join(';')}"/></path>`;
  }
  return `<path d="${d0}" fill="none" stroke="#BFE6D2" stroke-width="1.6" stroke-linecap="round" opacity="0.35"/>`;
}

/* ---- 平滑动势曲线（半透明，柔和箭头，无虚线） ---- */
function motionCurve(d, o) {
  const oo = Object.assign({ w: 3.2, op: 0.55, col: MINT, head: true, hs: 7 }, o || {});
  let head = '';
  const m = d.match(/M([\d.\- ]+)[QL]([\d.\- ]+)[QL]?([\d.\- ]*)/);
  if (oo.head && m) {
    const end = m[3].trim().split(' ').map(Number) || null;
    if (end && end.length === 2) {
      const prev = m[2].trim().split(' ').map(Number);
      const dx = end[0] - prev[prev.length - 2], dy = end[1] - prev[prev.length - 1];
      const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
      const bx = end[0] - ux * oo.hs, by = end[1] - uy * oo.hs;
      head = `<path d="M${f1(bx - uy * oo.hs * 0.62)} ${f1(by + ux * oo.hs * 0.62)}Q${f1(end[0])} ${f1(end[1])} ${f1(bx + uy * oo.hs * 0.62)} ${f1(by - ux * oo.hs * 0.62)}" fill="none" stroke="${oo.col}" stroke-width="${oo.w}" stroke-linecap="round" opacity="${oo.op}"/>`;
    }
  }
  return `<g><path d="${d}" fill="none" stroke="${oo.col}" stroke-width="${oo.w}" stroke-linecap="round" opacity="${oo.op}"/>${head}${oo.pulse ? `<animate attributeName="opacity" values="0.75;1;0.75" dur="${oo.pulse}s" repeatCount="indefinite"/>` : ''}</g>`;
}

/* ---- 柔和接触阴影（cxs/rxs 可为数字或数字数组） ---- */
function softShadow(cxs, cy, rxs, ry, dur) {
  const nums = a => (Array.isArray(a) && a[0] !== a[a.length - 1]) ? a.concat([a[0]]) : a;
  const t = Array.isArray(cxs) ? nums(cxs) : null, tr = Array.isArray(rxs) ? nums(rxs) : null;
  const cx0 = t ? t[0] : cxs, rx0 = tr ? tr[0] : rxs;
  let anim = '';
  if (t && dur) anim += `<animate attributeName="cx" values="${t.map(v => f1(v)).join(';')}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(t.length - 1).fill(SPL).join(';')}"/>`;
  if (tr && dur) anim += `<animate attributeName="rx" values="${tr.map(v => f1(v)).join(';')}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(tr.length - 1).fill(SPL).join(';')}"/>`;
  return `<ellipse cx="${f1(cx0)}" cy="${cy}" rx="${f1(rx0)}" ry="${ry}" fill="url(#shG)">${anim}</ellipse>`;
}

/* ---- 头（3/4：朝向眼点+高光） ---- */
function headQ(p, facing, dur, red) {
  const fill = red ? 'url(#headRed)' : HEAD;
  const eye = Array.isArray(p) ? p.map(q => pt(q.x + 5 * facing, q.y - 1)) : pt(p.x + 5 * facing, p.y - 1);
  const hi = Array.isArray(p) ? p.map(q => pt(q.x - 3, q.y - 3.5)) : pt(p.x - 3, p.y - 3.5);
  return `${joint(p, 9.5, fill, dur)}
  ${joint(eye, 1.8, '#F4FBF7', dur, 0.95)}
  ${joint(hi, 2.6, '#FFFFFF', dur, 0.4)}`;
}

/* ---- 胶囊文字 ---- */
function pill(x, y, text, opts) {
  const o = Object.assign({ fs: 12, anchor: 'start', cls: 'pill-t', W: 320, H: 200, dur: 4.6, rx: null, ry: null }, opts || {});
  let w = 0;
  for (const ch of text) w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF·×✕✓°]/.test(ch) ? o.fs : 0.58 * o.fs;
  w += 22;
  let rxx = o.rx !== null ? o.rx : (o.anchor === 'middle' ? x - w / 2 : o.anchor === 'end' ? x - w + 10 : x - 10);
  rxx = Math.max(8, Math.min(rxx, o.W - w - 8));
  const h = o.fs + 10;
  let ryy = o.ry !== null ? o.ry : Math.min(y - o.fs + 1, o.H - h - 2);
  ryy = Math.max(6, ryy);
  return `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="${o.dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
  <rect x="${f1(rxx)}" y="${f1(ryy)}" width="${f1(w)}" height="${h}" rx="${f1(h / 2)}" fill="#FFFFFF" opacity="0.68" stroke="#FFFFFF" stroke-width="1.2"/>
  <rect x="${f1(rxx)}" y="${f1(ryy)}" width="${f1(w)}" height="${h}" rx="${f1(h / 2)}" fill="none" stroke="#D5E7DE" stroke-width="1" opacity="0.9"/>
  <text x="${x}" y="${y}" text-anchor="${o.anchor}" class="${o.cls}" font-size="${o.fs}">${text}</text></g>`;
}

const STYLE = `<style>text{font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}.lbl{fill:#5F615E;font-size:11px;font-weight:600}.pill-t{fill:#0F6E56;font-size:10.5px;font-weight:700}</style>`;

function defs3(W, H, extra) {
  return `<defs>
  <linearGradient id="bgG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDFEFD"/><stop offset="0.6" stop-color="#EEF6F1"/><stop offset="1" stop-color="#E2EEE7"/></linearGradient>
  <radialGradient id="glowG" cx="0.5" cy="0.55" r="0.55"><stop offset="0" stop-color="#C8E8D8" stop-opacity="0.7"/><stop offset="1" stop-color="#C8E8D8" stop-opacity="0"/></radialGradient>
  <linearGradient id="bodyG" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#4D6158"/><stop offset="1" stop-color="#2B3833"/></linearGradient>
  <linearGradient id="bodyFar" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#A4B8AE"/><stop offset="1" stop-color="#7E958A"/></linearGradient>
  <linearGradient id="accG" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#58BD92"/><stop offset="1" stop-color="#2E9C74"/></linearGradient>
  <linearGradient id="redG" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#D96A57"/><stop offset="1" stop-color="#B23527"/></linearGradient>
  <radialGradient id="headG" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#5C6E65"/><stop offset="1" stop-color="#2B3833"/></radialGradient>
  <radialGradient id="headRed" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#D96A57"/><stop offset="1" stop-color="#B23527"/></radialGradient>
  <radialGradient id="shG" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7FA38F" stop-opacity="0.42"/><stop offset="0.55" stop-color="#9BBBA9" stop-opacity="0.25"/><stop offset="1" stop-color="#9BBBA9" stop-opacity="0"/></radialGradient>
  ${extra || ''}
  </defs>`;
}

function scene4(gy, cx, W, H, opt) {
  opt = opt || {};
  return `${defs3(W, H, opt.extraDefs)}
  <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="url(#bgG)"/>
  ${opt.noGlow ? '' : `<ellipse cx="${f1(cx)}" cy="${gy - 45}" rx="118" ry="76" fill="url(#glowG)"><animate attributeName="rx" values="118;126;118" dur="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/><animate attributeName="opacity" values="0.9;1;0.9" dur="4.2s" repeatCount="indefinite"/></ellipse>`}
  <path d="M12 ${gy} Q${W / 2} ${gy - 7} ${W - 12} ${gy} L${W - 12} ${gy + 6} Q${W / 2} ${gy + 13} 12 ${gy + 6} Z" fill="url(#groundG)"/>
  ${opt.shadow === false ? '' : softShadow(Array.isArray(opt.shadowCx) ? opt.shadowCx : cx, gy + 1, opt.shadowRx || 42, opt.shadowRy || 6.5, opt.shadowDur || 0)}
  <g fill="#2FA07C" opacity="0.5">
    <circle cx="52" cy="58" r="3"><animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" dur="5s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
    <circle cx="${W - 52}" cy="46" r="2.4" fill="#8FCDAE"><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="4.4s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
    <circle cx="${W - 32}" cy="126" r="3" fill="#D9A648" opacity="0.8"><animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="5.6s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
    <circle cx="40" cy="122" r="2.2" fill="#8FCDAE"><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="4.8s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
  </g>`;
}
// 场景用的地面渐变补充（放 extraDefs）
const GROUND = `<linearGradient id="groundG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E3EFE8"/><stop offset="1" stop-color="#D3E4DA"/></linearGradient>`;

function svgFile(W, H, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="学习园地动作演示">
${STYLE}
${body}
</svg>
`;
}

// ============================================================
// 通用人物渲染器：给定各关节轨迹(数组=动画)，输出扁平插画风人偶
// cfg: {sh, hip, head, legs:[{hip,knee,foot,fill,dur,front}], arms:[{sh,el,hand,fill,dur,front}], torsoW:[hipW,shW], dur, facing, red}
function figure(cfg) {
  const d = cfg.dur || 0;
  const out = [];
  const back = cfg.legs.concat(cfg.arms).filter(x => !x.front);
  const front = cfg.legs.concat(cfg.arms).filter(x => x.front);
  // 后侧肢体
  for (const L of back) {
    out.push(taper(L.a, L.b, L.w1, L.w2, L.fill || FAR, L.dur || d));
    out.push(taper(L.b, L.c, L.w2, (L.w3 || L.w2 * 0.72), L.fill || FAR, L.dur || d));
    out.push(joint(L.b, L.w2 * 0.52, L.fill || FAR, L.dur || d, 0.92));
    if (L.contour) out.push(contour(L.a, L.b, L.w1, L.dur || d));
  }
  // 躯干
  out.push(taper(cfg.hip, cfg.sh, cfg.torsoW ? cfg.torsoW[0] : 19, cfg.torsoW ? cfg.torsoW[1] : 15, cfg.red ? REDN : NEAR, d));
  // 前侧肢体
  for (const L of front) {
    out.push(taper(L.a, L.b, L.w1, L.w2, L.fill || NEAR, L.dur || d));
    out.push(taper(L.b, L.c, L.w2, (L.w3 || L.w2 * 0.72), L.fill || NEAR, L.dur || d));
    out.push(joint(L.b, L.w2 * 0.55, L.fill || NEAR, L.dur || d, 0.96));
    if (L.contour) out.push(contour(L.a, L.b, L.w1, L.dur || d));
  }
  // 肩、髋关节圆润点
  out.push(joint(cfg.sh, 8, cfg.red ? REDN : NEAR, d, 0.95));
  out.push(joint(cfg.hip, 9.5, cfg.red ? REDN : NEAR, d, 0.95));
  // 头
  out.push(headQ(cfg.head, cfg.facing || 1, d, cfg.red));
  return out.join('\n  ');
}

// ============================================================
const builds = {};

/* ---- 01 跑姿循环（残影关键帧：触地/缓冲/蹬伸/腾空） ---- */
const GAIT = {
  contact: { hy: 124, lean: 8, tN: 26, sN: 6, tF: -34, sF: -46, aN: 35, aF: -35 },
  load:    { hy: 128, lean: 10, tN: 6, sN: -6, tF: -46, sF: -18, aN: 12, aF: -12 },
  push:    { hy: 120, lean: 14, tN: -38, sN: -30, tF: 52, sF: 28, aN: -18, aF: 40 },
  flight:  { hy: 116, lean: 12, tN: 58, sN: 35, tF: -22, sF: -50, aN: 42, aF: -30 }
};
function miniFig(hx, ph, op, anim) {
  if (!anim) {
    const G = GAIT[ph];
    const hip = pt(hx, G.hy);
    const sh = seg(hip, 270 + G.lean, 24);
    const hd = seg(sh, 274 + G.lean, 11);
    const kN = seg(hip, 90 - G.tN, 17), fN = seg(kN, 90 - G.sN, 16);
    const kF = seg(hip, 90 - G.tF, 17), fF = seg(kF, 90 - G.sF, 15);
    const eN = seg(sh, 90 - G.aN, 10), hN = seg(eN, 90 - G.aN - 95, 9);
    const eF = seg(sh, 90 - G.aF, 10), hF = seg(eF, 90 - G.aF + 95, 9);
    const o = op || 1;
    return `
  <g opacity="${o}">
    ${taper(eF, hF, 6, 4.4, FAR)}${taper(kF, fF, 6.5, 5, FAR)}${taper(hip, kF, 8, 6.5, FAR)}
    ${taper(hip, sh, 11, 9, NEAR)}
    ${taper(hip, kN, 8.5, 6.8, NEAR)}${taper(kN, fN, 6.8, 5, NEAR)}
    ${taper(sh, eN, 6.8, 5.4, NEAR)}${taper(eN, hN, 5.4, 4.2, NEAR)}
    <circle cx="${f1(hd.x)}" cy="${f1(hd.y)}" r="7" fill="url(#headG)"/>
  </g>`;
  }
  // 动画主跑者：5 相位闭环
  const seq = ['contact', 'load', 'push', 'flight', 'contact'];
  const J = seq.map(k => {
    const g = GAIT[k], hip2 = pt(hx, g.hy), sh2 = seg(hip2, 270 + g.lean, 24);
    return {
      hip: hip2, sh: sh2, hd: seg(sh2, 274 + g.lean, 11),
      kN: seg(hip2, 90 - g.tN, 17), kF: seg(hip2, 90 - g.tF, 17),
      eN: seg(sh2, 90 - g.aN, 10), eF: seg(sh2, 90 - g.aF, 10)
    };
  });
  const T = k => J.map(j => j[k]);
  const feet = (kk, sk, len) => J.map((j, i) => seg(j[kk], 90 - GAIT[seq[i]][sk], len));
  const hands = (ek, ak, s) => J.map((j, i) => seg(j[ek], 90 - GAIT[seq[i]][ak] + s, 9));
  return `
  ${taper(T('eF'), hands('eF', 'aF', 95), 6, 4.4, FAR, 2.8)}
  ${taper(T('hip'), T('kF'), 8, 6.5, FAR, 2.8)}${taper(T('kF'), feet('kF', 'sF', 15), 6.5, 5, FAR, 2.8)}
  ${taper(T('hip'), T('sh'), 12, 10, NEAR, 2.8)}
  ${taper(T('hip'), T('kN'), 9, 7, NEAR, 2.8)}${taper(T('kN'), feet('kN', 'sN', 16), 7, 5.2, NEAR, 2.8)}
  ${joint(T('kN'), 3.8, NEAR, 2.8)}
  ${taper(T('sh'), T('eN'), 7, 5.6, NEAR, 2.8)}${taper(T('eN'), hands('eN', 'aN', -95), 5.6, 4.4, NEAR, 2.8)}
  ${headQ(T('hd'), 1, 2.8).replace(/r="9.5"/, 'r="7.6"')}`;
}
builds['01-run-form.svg'] = () => {
  let curves = '';
  for (const [x1, x2] of [[94, 114], [154, 174], [214, 234]]) {
    curves += motionCurve(`M${x1} 116 Q${(x1 + x2) / 2} 108 ${x2} 112`, { w: 2.6, op: 0.5, hs: 5 });
  }
  return svgFile(320, 200, `
  ${scene4(158, 160, 320, 200, { extraDefs: GROUND, shadowCx: [70, 130, 190, 252], shadow: false })}
  ${softShadow(70, 159, 20, 5)}${softShadow(130, 159, 20, 5)}${softShadow(190, 159, 20, 5)}${softShadow(252, 159, 24, 5.5)}
  ${miniFig(70, 'contact', 0.34)}${miniFig(130, 'load', 0.22)}${miniFig(190, 'push', 0.13)}
  ${curves}
  ${miniFig(252, null, 1, true)}
  ${[[70, '触地'], [130, '缓冲'], [190, '蹬伸'], [252, '腾空']].map(([x, t], i) => pill(x, 190, t, { fs: 11, anchor: 'middle', dur: 4.2 + i * 0.4 })).join('\n  ')}
  ${pill(26, 30, '跑姿循环：落地在重心下方，连贯推进不刹车', { fs: 12, dur: 4.6 })}
  ${pill(268, 26, '目视前方', { fs: 10.5, anchor: 'end', dur: 5.1, rx: 208, ry: 14 })}`);
};

/* ---- 02 前倾对比：左✕驼背腿直(红) 右✓全身一线前倾 ---- */
builds['02-run-lean.svg'] = () => {
  const dur = 3.4;
  const lHip = pt(99, 122), lMb = pt(108, 103), lSh = pt(119, 92), lHead = pt(129, 83);
  const left = `
  <line x1="99" y1="170" x2="99" y2="62" stroke="${RED}" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
  ${figure({
    red: true, facing: 1,
    hip: lHip, sh: lSh, head: lHead,
    torsoW: [15, 12],
    legs: [
      { a: lHip, b: pt(97, 146), c: pt(106, 168), w1: 8.5, w2: 6.5, w3: 4.8, front: true, fill: REDN },
      { a: lHip, b: pt(105, 147), c: pt(113, 168), w1: 8, w2: 6, w3: 4.5, front: false, fill: REDN }
    ],
    arms: [
      { a: lSh, b: pt(112, 110), c: pt(120, 124), w1: 6, w2: 4.6, w3: 3.8, front: true, fill: REDN },
      { a: lSh, b: pt(133, 108), c: pt(139, 121), w1: 5.6, w2: 4.4, w3: 3.6, front: false, fill: REDN }
    ]
  })}
  ${motionCurve('M104 76 Q112 70 122 76', { w: 2.2, op: 0.4, col: RED, head: false })}`;
  const rAnkle = pt(246, 170);
  const J = deg => {
    const A = 270 + deg;
    return { knee: seg(rAnkle, A, 30), hip: seg(rAnkle, A, 58), sh: seg(rAnkle, A, 96), hd: seg(rAnkle, A, 113) };
  };
  const J0 = J(0), J1 = J(8);
  const T = k => [J0[k], J1[k]];
  const el = j => seg(j.sh, 90 - 14, 14);
  const ha = j => seg(el(j), 90 - 10, 13);
  const right = `
  <line x1="246" y1="168" x2="246" y2="54" stroke="${TEAL}" stroke-width="2" stroke-linecap="round" opacity="0.45"/>
  <path d="M246 68 A14 14 0 0 1 259 76" fill="none" stroke="${MINT}" stroke-width="1.8" stroke-linecap="round" opacity="0.8"/>
  ${taper(T('sh'), [el(J0), el(J1)], 6, 4.6, NEAR, dur)}${taper([el(J0), el(J1)], [ha(J0), ha(J1)], 4.6, 3.8, NEAR, dur)}
  ${taper(T('hip'), T('sh'), 17, 13, NEAR, dur)}
  ${taper(T('hip'), T('knee'), 10.5, 7.5, ACC, dur)}${taper(T('knee'), [rAnkle, rAnkle], 7.5, 5, ACC, dur)}
  ${joint(T('knee'), 4.2, ACC, dur)}
  ${joint(T('sh'), 7.5, NEAR, dur)}${joint(T('hip'), 9, NEAR, dur)}
  ${headQ(T('hd'), 1, dur)}`;
  return svgFile(320, 210, `
  ${defs3(320, 210, GROUND + `<radialGradient id="shG2" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7FA38F" stop-opacity="0.4"/><stop offset="1" stop-color="#9BBBA9" stop-opacity="0"/></radialGradient>`)}
  <rect x="0" y="0" width="320" height="210" rx="14" fill="url(#bgG)"/>
  <path d="M12 174 Q160 167 308 174 L308 180 Q160 187 12 180 Z" fill="url(#groundG)"/>
  <ellipse cx="246" cy="172" rx="36" ry="6" fill="url(#shG2)"><animate attributeName="rx" values="34;40;34" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></ellipse>
  <ellipse cx="102" cy="172" rx="32" ry="5.5" fill="url(#shG2)" opacity="0.85"/>
  ${left}
  ${right}
  ${pill(80, 26, '✕ 弯腰驼背（腿是直的）', { fs: 12.5, anchor: 'middle', cls: 'lbl', W: 320, H: 210, dur: 4.2 })}
  ${pill(240, 26, '✓ 全身一条直线前倾', { fs: 12.5, anchor: 'middle', W: 320, H: 210, dur: 4.8 })}
  ${pill(262, 66, '5-10°', { fs: 11, anchor: 'start', W: 320, H: 210, dur: 4.5, rx: 244, ry: 54 })}
  ${pill(26, 198, '前倾发生在脚踝：头-肩-髋-膝-踝始终一条直线', { fs: 12, W: 320, H: 210, dur: 5 })}`);
};

/* ---- 03 步频节奏 ---- */
builds['03-run-cadence.svg'] = () => {
  const dur = 1.5;
  const hip = pt(160, 104), sh = pt(170, 66);
  const kN = [seg(hip, 90 - 26, 27), seg(hip, 90 + 14, 27)], fN = [seg(kN[0], 90 - 2, 26), seg(kN[1], 90 + 44, 24)];
  const kF = [seg(hip, 90 + 24, 27), seg(hip, 90 - 26, 27)], fF = [seg(kF[0], 90 + 50, 23), seg(kF[1], 90 + 0, 26)];
  const eN = [seg(sh, 90 + 46, 15), seg(sh, 90 - 34, 15)], hN = [seg(eN[0], 90 + 46 - 95, 14), seg(eN[1], 90 - 34 - 95, 14)];
  const eF = [seg(sh, 90 - 38, 15), seg(sh, 90 + 42, 15)], hF = [seg(eF[0], 90 - 38 + 95, 14), seg(eF[1], 90 + 42 + 95, 14)];
  let dots = '';
  for (let k = 0; k < 8; k++) {
    const x0 = 56 + k * 30;
    dots += `<circle cx="${x0}" cy="186" r="${k % 2 ? 2.2 : 3}" fill="${k % 2 ? '#A8C6B8' : '#0F6E56'}" opacity="${0.25 + k * 0.07}"><animate attributeName="cx" values="${x0};${x0 + 30}" dur="${(1.5 * (k + 2) / 4).toFixed(2)}s" repeatCount="indefinite"/></circle>`;
  }
  return svgFile(320, 200, `
  ${scene4(170, 164, 320, 200, { extraDefs: GROUND, shadowCx: 160, shadowRx: 34, shadowDur: 0 })}
  ${dots}
  ${motionCurve('M96 128 Q128 100 156 96', { w: 3, op: 0.4, hs: 6 })}
  ${taper(eF, hF, 8, 6, FAR, dur)}${taper(hip, kF, 10, 7.5, FAR, dur)}${taper(kF, fF, 7.5, 5.5, FAR, dur)}
  ${taper(hip, sh, 18, 14, NEAR, dur)}
  ${taper(hip, kN, 11, 8, ACC, dur)}${taper(kN, fN, 8, 5.5, ACC, dur)}${joint(kN, 4.4, ACC, dur)}
  ${contour(hip, kN, 11, dur)}
  ${taper(sh, eN, 8.5, 6.5, NEAR, dur)}${taper(eN, hN, 6.5, 5, NEAR, dur)}${joint(eN, 3.6, NEAR, dur)}
  ${headQ([seg(sh, 90 - 15, 13), seg(sh, 90 - 13, 13)], 1, dur)}
  ${pill(26, 30, '步频 170-180+/分：小步幅 · 快节奏 · 落地轻', { fs: 12, dur: 4.7 })}`);
};

/* ---- 04 落地缓冲（上✕下✓） ---- */
builds['04-run-landing.svg'] = () => {
  const panel = (gy, red, over) => {
    const hip = pt(150, gy - 94), sh = pt(158, gy - 126), hd = seg(sh, 278, 13);
    const kF = seg(hip, over ? 90 - 46 : 90 - 8, 27), fF = seg(kF, over ? 90 - 36 : 90 + 4, 26);
    const kB = seg(hip, 90 + 30, 27), fB = seg(kB, 90 + 55, 23);
    const eN = seg(sh, 90 + 50, 15), hN = seg(eN, 90 + 50 - 95, 14);
    const eF = seg(sh, 90 - 40, 15), hF = seg(eF, 90 - 40 + 95, 14);
    const col = red ? RED : TEAL, fill = red ? REDN : NEAR, fillL = red ? REDN : ACC;
    return `
  <line x1="150" y1="${gy - 64}" x2="150" y2="${gy - 2}" stroke="${col}" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
  ${taper(eF, hF, 8, 6, red ? REDN : FAR)}
  ${taper(hip, kB, 10, 7.5, red ? REDN : FAR)}${taper(kB, fB, 7.5, 5.5, red ? REDN : FAR)}
  ${taper(hip, sh, 17, 13, fill)}
  ${taper(sh, eN, 8.5, 6.5, fill)}${taper(eN, hN, 6.5, 5, fill)}
  ${taper(hip, kF, 11, 8, fillL)}${taper(kF, fF, 8, 5.5, fillL)}${joint(kF, 4.4, fillL)}
  ${headQ(hd, 1, 0, red)}
  ${over
      ? motionCurve(`M204 ${gy - 6} Q194 ${gy - 10} 184 ${gy - 6}`, { w: 2.6, op: 0.6, col: RED, hs: 5 })
      : motionCurve(`M144 ${gy - 4} Q150 ${gy - 10} 156 ${gy - 4}`, { w: 2.6, op: 0.6, hs: 5 })}`;
  };
  return svgFile(320, 230, `
  ${defs3(320, 230, GROUND + `<radialGradient id="shG2" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#7FA38F" stop-opacity="0.4"/><stop offset="1" stop-color="#9BBBA9" stop-opacity="0"/></radialGradient>`)}
  <rect x="0" y="0" width="320" height="230" rx="14" fill="url(#bgG)"/>
  <path d="M12 98 Q160 91 308 98 L308 104 Q160 111 12 104 Z" fill="url(#groundG)" opacity="0.85"/>
  <path d="M12 221 Q160 214 308 221 L308 227 Q160 228 12 227 Z" fill="url(#groundG)" opacity="0.85"/>
  <ellipse cx="150" cy="97" rx="30" ry="5" fill="url(#shG2)" opacity="0.8"/>
  <ellipse cx="150" cy="220" rx="32" ry="5.5" fill="url(#shG2)" opacity="0.9"/>
  ${panel(98, true, true)}
  ${panel(221, false, false)}
  ${pill(80, 22, '✕ 脚跟远伸 = 刹车 + 冲击', { fs: 13, anchor: 'middle', cls: 'lbl', W: 320, H: 230, dur: 4.2 })}
  ${pill(80, 130, '✓ 落在重心下方 = 顺畅缓冲', { fs: 13, anchor: 'middle', W: 320, H: 230, dur: 4.9 })}
  ${pill(150, 44, '重心', { fs: 10, anchor: 'end', cls: 'lbl', W: 320, H: 230, dur: 4.4, rx: 112, ry: 32 })}
  ${pill(150, 152, '重心', { fs: 10, anchor: 'end', cls: 'lbl', W: 320, H: 230, dur: 5.2, rx: 112, ry: 140 })}`);
};

/* ---- 05 摆腿（扶墙，3/4） ---- */
builds['05-dyn-leg-swing.svg'] = () => {
  const dur = 2.6;
  const sh = pt(196, 66), hip = pt(188, 104), hd = seg(sh, 272, 14);
  const wall = `<line x1="262" y1="48" x2="262" y2="170" stroke="#B7CCC1" stroke-width="5" stroke-linecap="round"/><line x1="262" y1="64" x2="254" y2="72" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/><line x1="262" y1="96" x2="254" y2="104" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/><line x1="262" y1="128" x2="254" y2="136" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/><line x1="262" y1="156" x2="254" y2="164" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/>`;
  // 摆动腿（青绿）：前摆/后摆 两相位，伸直
  const kS = [seg(hip, 90 - 32, 26), seg(hip, 90 + 34, 26)];
  const fS = [seg(kS[0], 90 - 30, 24), seg(kS[1], 90 + 34, 22)];
  // 支撑腿直
  const kP = seg(hip, 90 + 4, 27), fP = seg(kP, 90 - 2, 25);
  // 双手扶墙（前伸），肘微弯不贴身
  const eN = seg(sh, 90 - 74, 14), hN = seg(eN, 90 - 88, 13);
  const eF = seg(sh, 90 - 68, 14), hF = seg(eF, 90 - 86, 13);
  return svgFile(320, 200, `
  ${scene4(170, 200, 320, 200, { extraDefs: GROUND, shadowCx: [172, 178, 172], shadowRx: [34, 40, 34], shadowRy: 6, shadowDur: dur })}
  ${wall}
  ${motionCurve('M118 118 Q150 86 190 84', { w: 3.2, op: 0.55, pulse: dur })}
  ${motionCurve('M118 152 Q152 158 186 150', { w: 2.6, op: 0.4, pulse: dur + 0.4 })}
  ${taper(eF, hF, 8, 6, FAR)}
  ${taper(hip, kP, 10, 7.5, FAR)}${taper(kP, fP, 7.5, 5.5, FAR)}${joint(kP, 4.2, FAR)}
  ${taper(hip, sh, 18, 14, NEAR)}
  ${taper(sh, eN, 8.5, 6.5, NEAR)}${taper(eN, hN, 6.5, 5, NEAR)}
  ${taper(hip, kS, 11, 7, ACC, dur)}${taper(kS, fS, 7, 4.8, ACC, dur)}${joint(kS, 4, ACC, dur)}
  ${contour(hip, kS, 11, dur)}
  ${headQ(hd, 1, 0)}
  ${pill(26, 30, '扶墙侧立，摆动腿伸直前后摆', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '各 10-15 次，幅度由小到大，膝盖不弯', { fs: 12, dur: 5.2 })}`);
};

/* ---- 06 弓步走（3/4，体块，发力） ---- */
builds['06-dyn-lunge.svg'] = () => {
  const dur = 3;
  const A = { hip: pt(174, 116), sh: pt(173, 78) }, B = { hip: pt(178, 136), sh: pt(175, 98) };
  const hipT = [A.hip, B.hip], shT = [A.sh, B.sh], hdT = [seg(A.sh, 268, 15), seg(B.sh, 269, 15)];
  const kneeF = [pt(198, 136), pt(204, 152)], footF = pt(220, 168);
  const kneeB = [pt(150, 144), pt(151, 158)], footB = pt(126, 166);
  const elT = [seg(A.sh, 90 + 40, 15), seg(B.sh, 90 + 38, 15)], haT = [pt(170, 110), pt(174, 128)];
  const elF2 = [seg(A.sh, 90 - 32, 15), seg(B.sh, 90 - 30, 15)], haF2 = [pt(181, 106), pt(185, 124)];
  return svgFile(320, 200, `
  ${scene4(170, 178, 320, 200, { extraDefs: GROUND, shadowCx: [176, 180, 176], shadowRx: [44, 36, 44], shadowRy: 6.5, shadowDur: dur })}
  <line x1="220" y1="128" x2="220" y2="164" stroke="${TEAL}" stroke-width="2" stroke-linecap="round" opacity="0.45"><animate attributeName="y1" values="128;144;128" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></line>
  ${taper(elF2, haF2, 8.5, 6.5, FAR, dur)}${taper(hipT, kneeB, 10, 7.5, FAR, dur)}${taper(kneeB, [footB, footB], 7.5, 5.5, FAR, dur)}${joint(kneeB, 4.2, FAR, dur)}
  ${taper(hipT, shT, 20, 15, NEAR, dur)}
  ${taper(kneeF, [footF, footF], 8, 5.5, ACC, dur)}${taper(hipT, kneeF, 12, 8, ACC, dur)}${joint(kneeF, 4.6, ACC, dur)}
  ${contour(hipT, kneeF, 12, dur)}
  ${taper(shT, elT, 9, 7, NEAR, dur)}${taper(elT, haT, 7, 5.4, NEAR, dur)}${joint(elT, 3.8, NEAR, dur)}
  ${headQ(hdT, 1, dur)}
  ${motionCurve('M232 154 Q244 143 250 128', { w: 3, op: 0.6, pulse: dur })}
  ${pill(220, 140, '膝不过脚尖', { fs: 10.5, anchor: 'start', dur: 4.5, rx: 228, ry: 124 })}
  ${pill(26, 30, '弓步走：躯干正直下压，前膝对准脚尖方向', { fs: 12, dur: 4.8 })}
  ${pill(26, 192, '每侧 8-10 次，后膝下沉但不触地', { fs: 12, dur: 5.3 })}`);
};

/* ---- 07 高抬腿（生物力学：支撑直腿、大腿平行地面、小腿下垂、前冲趋势、臂90°） ---- */
builds['07-dyn-high-knees.svg'] = () => {
  const dur = 1.7;
  const sh = pt(178, 62), hip = pt(164, 100);
  // 支撑腿（近）：笔直，髋下微后
  const kP = pt(160, 134), fP = pt(156, 162);
  // 抬起腿（青绿，前）：大腿平行地面（y 与髋一致），小腿自然下垂
  const kS = [pt(196, 102), pt(196, 97)];            // 膝在髋前、与髋同高（平行地面）
  const fS = [pt(198, 130), pt(198, 124)];           // 小腿垂直下垂
  // 臂 90° 前后摆，不贴身（肘离躯干明显）
  const eN = [pt(196, 76), pt(194, 70)], hN = [pt(202, 92), pt(204, 84)];
  const eF = [pt(158, 78), pt(160, 72)], hF = [pt(152, 94), pt(150, 86)];
  const bob = [0, -2, 0]; // 身体轻微上提趋势
  const hd = [pt(192, 48), pt(192, 46)];
  return svgFile(320, 200, `
  ${scene4(168, 158, 320, 200, { extraDefs: GROUND, shadowCx: [156, 152, 156], shadowRx: [30, 26, 30], shadowRy: 5.5, shadowDur: dur })}
  <line x1="118" y1="100" x2="262" y2="100" stroke="${TEAL}" stroke-width="2" stroke-linecap="round" opacity="0.45"/>
  ${motionCurve('M108 128 Q140 108 168 102', { w: 3.2, op: 0.5, pulse: dur * 2 })}
  ${motionCurve('M112 152 Q148 142 178 138', { w: 2.4, op: 0.35, pulse: dur * 2.2 })}
  ${taper([sh, pt(sh.x, sh.y - 2), sh], [eF, pt(eF.x, eF.y - 2), eF], 8.5, 6.5, FAR, dur)}
  ${taper([eF, pt(eF.x, eF.y - 2), eF], [hF, pt(hF.x, hF.y - 2), hF], 6.5, 5, FAR, dur)}
  ${taper(hip, kP, 12, 8.5, FAR)}${taper(kP, fP, 8.5, 6, FAR)}${joint(kP, 4.6, FAR)}${contour(hip, kP, 12)}
  ${taper(hip, sh, 20, 16, NEAR)}
  ${taper([hip, pt(hip.x, hip.y - 2), hip], [kS[0], kS[1], kS[0]], 12, 8, ACC, dur)}
  ${taper(kS, fS, 8, 5.5, ACC, dur)}${joint(kS, 4.6, ACC, dur)}
  ${contour([hip, pt(hip.x, hip.y - 2), hip], kS, 12, dur)}
  ${taper([sh, pt(sh.x, sh.y - 2), sh], [eN, pt(eN.x, eN.y - 2), eN], 9, 7, NEAR, dur)}
  ${taper([eN, pt(eN.x, eN.y - 2), eN], [hN, pt(hN.x, hN.y - 2), hN], 7, 5.4, NEAR, dur)}
  ${joint(sh, 8.5, NEAR)}${joint(hip, 10, NEAR)}
  ${headQ(hd, 1, dur)}
  <g><path d="M156 166 L156 174" stroke="${MINT}" stroke-width="2.4" stroke-linecap="round" opacity="0.7"><animate attributeName="opacity" values="0.9;0.3;0.9" dur="${dur}s" repeatCount="indefinite"/></path></g>
  ${pill(268, 104, '大腿平行地面', { fs: 10.5, anchor: 'start', dur: 4.4, rx: 224, ry: 88 })}
  ${pill(26, 192, '膝盖抬到髋部高度，前脚掌轻快落地 · 20-30 秒', { fs: 12, dur: 5 })}`);
};

/* ---- 08 髋部环绕（手贴髋画圈） ---- */
builds['08-dyn-hip-circle.svg'] = () => {
  const dur = 4;
  const sh0 = pt(160, 58);
  const pelvis = [pt(154, 104), pt(160, 110), pt(166, 104), pt(160, 98)];
  const hipL = pelvis.map(p => pt(p.x - 14, p.y)), hipR = pelvis.map(p => pt(p.x + 14, p.y));
  const kL = [pt(142, 132), pt(146, 136), pt(148, 132), pt(144, 128)], fL = pt(140, 164);
  const kR = [pt(178, 132), pt(174, 136), pt(172, 132), pt(176, 128)], fR = pt(180, 164);
  const shT = [sh0, pt(163, 56), sh0, pt(157, 56)];
  const elL = shT.map(s => pt(s.x - 24, s.y + 16)), elR = shT.map(s => pt(s.x + 24, s.y + 16));
  const haL = pelvis.map((_, i) => pt(hipL[i].x + 4, hipL[i].y - 2));
  const haR = pelvis.map((_, i) => pt(hipR[i].x - 4, hipR[i].y - 2));
  const hdT = [pt(160, 44), pt(163, 42), pt(160, 44), pt(157, 42)];
  return svgFile(320, 200, `
  ${scene4(170, 164, 320, 200, { extraDefs: GROUND, shadowCx: 160, shadowRx: 38, shadowDur: 0 })}
  <ellipse cx="160" cy="104" rx="26" ry="10" fill="none" stroke="${MINT}" stroke-width="2.2" opacity="0.45"/>
  ${motionCurve('M134 104 Q160 90 186 104', { w: 2.6, op: 0.5, hs: 6 })}
  ${taper(elL, haL, 8.5, 6.5, FAR, dur)}${taper(hipL, kL, 10, 7.5, FAR, dur)}${taper(kL, [fL, fL, fL, fL], 7.5, 5.5, FAR, dur)}${joint(kL, 4.2, FAR, dur)}
  ${taper(hipL, hipR, 21, 21, NEAR, dur)}
  ${taper(hipR, kR, 11, 8, ACC, dur)}${taper(kR, [fR, fR, fR, fR], 8, 5.5, ACC, dur)}${joint(kR, 4.4, ACC, dur)}
  ${taper(shT, elL, 9, 7, FAR, dur)}
  ${taper(shT, hipL, 19, 19, NEAR, dur)}
  ${taper(shT, elR, 9, 7, NEAR, dur)}${taper(elR, haR, 7, 5.4, NEAR, dur)}${joint(elR, 3.8, NEAR, dur)}
  ${joint(shT, 8.5, NEAR, dur)}
  ${headQ(hdT, 1, dur)}
  ${pill(26, 26, '双手叉腰，骨盆前后左右画圈', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '上身保持稳定，膝盖随骨盆自然开合 · 每侧 8-10 圈', { fs: 12, dur: 5.2 })}`);
};

/* ---- 09 小腿拉伸（扶墙，后腿蹬直强调） ---- */
builds['09-st-calf.svg'] = () => {
  const dur = 3;
  const wall = `<line x1="272" y1="46" x2="272" y2="170" stroke="#B7CCC1" stroke-width="5" stroke-linecap="round"/><line x1="272" y1="60" x2="264" y2="68" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/><line x1="272" y1="90" x2="264" y2="98" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/><line x1="272" y1="120" x2="264" y2="128" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/><line x1="272" y1="150" x2="264" y2="158" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/>`;
  const shT = [pt(206, 66), pt(210, 70)], hipT = [pt(200, 108), pt(204, 110)];
  const hdT = [seg(shT[0], 280, 13), seg(shT[1], 280, 13)];
  const haN = pt(264, 76), haF = pt(266, 88);
  const elN = [seg(haN, 182, 15), seg(haN, 186, 15)], elF = [seg(haF, 188, 15), seg(haF, 192, 15)];
  const kneeF = [pt(224, 134), pt(226, 136)], footF = pt(240, 166);
  const kneeB = [pt(180, 136), pt(182, 137)], heelB = [pt(158, 166), pt(158, 166)];
  return svgFile(320, 200, `
  ${scene4(170, 232, 320, 200, { extraDefs: GROUND, shadowCx: 200, shadowRx: 42, shadowDur: 0 })}
  ${wall}
  ${taper(elF, [haF, haF], 8, 6, FAR, dur)}${taper(hipT, kneeF, 10, 7.5, FAR, dur)}${taper(kneeF, [footF, footF], 7.5, 5.5, FAR, dur)}${joint(kneeF, 4.2, FAR, dur)}
  ${taper(hipT, shT, 19, 15, NEAR, dur)}
  ${taper(shT, elN, 9, 7, NEAR, dur)}${taper(elN, [haN, haN], 7, 5.4, NEAR, dur)}${joint(elN, 3.8, NEAR, dur)}
  ${taper(hipT, kneeB, 11.5, 8, ACC, dur)}${taper(kneeB, heelB, 8, 5.5, ACC, dur)}${joint(kneeB, 4.6, ACC, dur)}
  ${contour(hipT, kneeB, 11.5, dur)}
  ${headQ(hdT, 1, dur)}
  ${motionCurve('M150 118 Q186 112 222 104', { w: 3, op: 0.5, pulse: dur })}
  ${pill(150, 132, '后腿蹬直', { fs: 10.5, anchor: 'end', dur: 4.5 })}
  ${pill(26, 192, '后腿伸直、脚跟踩地，身体缓慢前压 · 每侧 20-30 秒', { fs: 12, dur: 5 })}`);
};

/* ---- 10 股四头肌拉伸 ---- */
builds['10-st-quad.svg'] = () => {
  const dur = 3.2;
  const sh = pt(158, 64), hip = pt(154, 100), hd = seg(sh, 268, 13);
  const footS = pt(156, 168);
  const kneeQ = [pt(168, 128), pt(170, 126)], footQ = [pt(176, 104), pt(178, 101)];
  const elB = [pt(178, 90), pt(180, 88)];
  const elF = seg(sh, 90 + 30, 15), haF = seg(elF, 90 + 24, 14);
  return svgFile(320, 200, `
  ${scene4(170, 156, 320, 200, { extraDefs: GROUND, shadowCx: 156, shadowRx: 30, shadowDur: 0 })}
  ${taper(elF, haF, 8.5, 6.5, FAR)}${taper(hip, footS, 11, 7.5, FAR)}${joint(hip, 10, NEAR)}
  ${taper(hip, sh, 19, 15, NEAR)}
  ${taper(sh, elB, 9, 7, NEAR, dur)}${taper(elB, footQ, 7, 5.4, NEAR, dur)}${joint(elB, 3.8, NEAR, dur)}
  ${taper(hip, kneeQ, 12, 8, ACC, dur)}${taper(kneeQ, footQ, 8, 5.5, ACC, dur)}${joint(kneeQ, 4.6, ACC, dur)}
  ${headQ(hd, 1, 0)}
  ${motionCurve('M172 118 Q160 108 150 112', { w: 2.8, op: 0.5, pulse: dur })}
  ${pill(26, 30, '手抓脚背拉向臀部，膝盖指向正下方', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '大腿前侧有牵拉感即可，髋部微微前送 · 每侧 20-30 秒', { fs: 12, dur: 5.2 })}`);
};

/* ---- 11 腘绳肌拉伸（坐姿前屈） ---- */
builds['11-st-hamstring.svg'] = () => {
  const dur = 3.6;
  const sit = pt(148, 162), foot = pt(224, 164), knee = pt(186, 162);
  const shA = pt(136, 116), shB = pt(160, 130);
  const shT = [shA, shB], hdT = [seg(shA, 276, 13), seg(shB, 278, 13)];
  const elT = [seg(shA, 90 - 20, 15), seg(shB, 90 - 14, 15)], haT = [pt(166, 128), pt(198, 146)];
  const elF = [seg(shA, 90 - 6, 15), seg(shB, 90 - 8, 15)], haF = [pt(158, 140), pt(190, 154)];
  return svgFile(320, 200, `
  ${scene4(170, 176, 320, 200, { extraDefs: GROUND, shadowCx: 180, shadowRx: 46, shadowDur: 0 })}
  ${taper(elF, haF, 8.5, 6.5, FAR, dur)}
  ${taper([sit, sit], [knee, knee], 11, 8, FAR, dur)}${taper([knee, knee], [foot, foot], 8, 5.5, FAR, dur)}
  ${taper([sit, sit], shT, 20, 15, NEAR, dur)}
  ${taper(shT, elT, 9, 7, NEAR, dur)}${taper(elT, haT, 7, 5.4, NEAR, dur)}${joint(elT, 3.8, NEAR, dur)}
  ${taper([sit, sit], [knee, knee], 12, 8.5, ACC, dur)}${taper([knee, knee], [foot, foot], 8.5, 6, ACC, dur)}
  ${headQ(hdT, 1, dur)}
  ${motionCurve('M150 118 Q168 128 190 138', { w: 2.8, op: 0.5, pulse: dur })}
  ${pill(210, 150, '腿伸直', { fs: 10.5, anchor: 'start', dur: 4.4, rx: 218, ry: 136 })}
  ${pill(26, 30, '坐姿，背挺直、从髋部前倾够向脚尖', { fs: 12, dur: 4.8 })}
  ${pill(26, 192, '大腿后侧有牵拉感即可，不要弓背 · 20-30 秒', { fs: 12, dur: 5.4 })}`);
};

/* ---- 12 髋屈肌拉伸（半跪 3/4） ---- */
builds['12-st-hipflexor.svg'] = () => {
  const dur = 3.4;
  const sh = pt(168, 88), hipT = [pt(164, 128), pt(169, 130)], hd = seg(sh, 270, 14);
  // 前腿：脚踩地
  const kF = [pt(184, 138), pt(186, 140)], fF = pt(204, 166);
  // 后腿：膝点地，小腿沿地面向后
  const kB = [pt(148, 160), pt(150, 160)], fB = pt(118, 165);
  // 手：一只按前膝，一只叉腰
  const eN = seg(sh, 90 + 62, 15), hN = [pt(184, 132), pt(186, 134)];
  const eF = seg(sh, 90 - 34, 15), hF = [pt(158, 112), pt(162, 114)];
  return svgFile(320, 200, `
  ${scene4(170, 168, 320, 200, { extraDefs: GROUND, shadowCx: [166, 170, 166], shadowRx: [42, 38, 42], shadowRy: 6, shadowDur: dur })}
  ${taper(eF, hF, 8.5, 6.5, FAR, dur)}
  ${taper(hipT, kB, 11, 8, FAR, dur)}${taper(kB, [fB, fB], 8, 5.5, FAR, dur)}${joint(kB, 4.4, FAR, dur)}
  ${taper(hipT, [sh, sh], 20, 15, NEAR, dur)}
  ${taper(sh, eN, 9, 7, NEAR, 0)}${taper(eN, hN, 7, 5.4, NEAR, dur)}${joint(eN, 3.8, NEAR)}
  ${taper(hipT, kF, 12, 8.5, ACC, dur)}${taper(kF, [fF, fF], 8.5, 6, ACC, dur)}${joint(kF, 4.6, ACC, dur)}
  ${contour(hipT, kF, 12, dur)}
  ${headQ(hd, 1, 0)}
  ${motionCurve('M148 116 Q160 122 172 126', { w: 3, op: 0.55, pulse: dur })}
  ${pill(26, 30, '半跪姿：髋部向前下方送，收紧臀部', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '感受大腿前侧 / 髋前侧牵拉 · 每侧 20-30 秒', { fs: 12, dur: 5.2 })}`);
};

/* ---- 13 臀肌拉伸（仰卧拉膝） ---- */
builds['13-st-glute.svg'] = () => {
  const dur = 3.4;
  const hip = pt(140, 166), sh = pt(96, 166), hd = pt(84, 158);
  const footG = pt(214, 163);
  const kneeT = [pt(112, 148), pt(106, 142)], footT = [pt(146, 138), pt(140, 130)];
  const elN = [pt(112, 152), pt(106, 146)];
  const elF = [pt(116, 156), pt(110, 150)];
  return svgFile(320, 200, `
  ${scene4(170, 158, 320, 200, { extraDefs: GROUND, shadowCx: 156, shadowRx: 48, shadowDur: 0 })}
  ${taper(elF, kneeT, 8.5, 6.5, FAR, dur)}
  ${taper(hip, footG, 12, 8, NEAR)}
  ${taper(hip, kneeT, 12, 8, ACC, dur)}${taper(kneeT, footT, 8, 5.5, ACC, dur)}${joint(kneeT, 4.6, ACC, dur)}
  ${taper(hip, sh, 20, 15, NEAR)}
  ${taper(sh, elN, 9, 7, NEAR, dur)}${taper(elN, kneeT, 7, 5.4, NEAR, dur)}${joint(elN, 3.8, NEAR, dur)}
  <circle cx="${hd.x}" cy="${hd.y}" r="9.5" fill="url(#headG)"/><circle cx="${hd.x - 3}" cy="${hd.y - 3.5}" r="2.6" fill="#FFFFFF" opacity="0.4"/>
  ${motionCurve('M118 126 Q108 130 100 134', { w: 2.8, op: 0.5, pulse: dur })}
  ${pill(26, 30, '仰卧，双手把一侧膝盖拉向胸口', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '另一条腿放松伸直贴地 · 每侧 20-30 秒', { fs: 12, dur: 5.2 })}`);
};

/* ---- 14 深蹲（先送髋） ---- */
builds['14-squat.svg'] = () => {
  const dur = 3.2;
  const A = { hip: pt(168, 106), sh: pt(172, 68) }, B = { hip: pt(146, 126), sh: pt(176, 94) };
  const hipT = [A.hip, B.hip], shT = [A.sh, B.sh], hdT = [seg(A.sh, 272, 14), seg(B.sh, 278, 14)];
  const footN = pt(200, 168), footF = pt(190, 168);
  const kneeN = [pt(178, 138), pt(190, 142)], kneeF = [pt(170, 140), pt(181, 145)];
  const elT = [seg(A.sh, 90 + 76, 15), seg(B.sh, 90 + 84, 15)];
  const haT = [seg(A.sh, 90 + 98, 28), seg(B.sh, 90 + 96, 29)];
  const elF = [seg(A.sh, 90 + 46, 15), seg(B.sh, 90 + 66, 15)];
  const haF = [seg(A.sh, 90 + 62, 27), seg(B.sh, 90 + 84, 27)];
  return svgFile(320, 200, `
  ${scene4(170, 176, 320, 200, { extraDefs: GROUND, shadowCx: [178, 172, 178], shadowRx: [40, 46, 40], shadowRy: 6, shadowDur: dur })}
  <line x1="200" y1="130" x2="200" y2="164" stroke="${TEAL}" stroke-width="2" stroke-linecap="round" opacity="0.45"/>
  ${taper(elF, haF, 8.5, 6.5, FAR, dur)}
  ${taper(hipT, kneeF, 11, 8, FAR, dur)}${taper(kneeF, [footF, footF], 8, 5.5, FAR, dur)}${joint(kneeF, 4.4, FAR, dur)}
  ${taper(hipT, shT, 20, 16, NEAR, dur)}
  ${taper(hipT, kneeN, 12.5, 8.5, ACC, dur)}${taper(kneeN, [footN, footN], 8.5, 6, ACC, dur)}${joint(kneeN, 4.8, ACC, dur)}
  ${contour(hipT, kneeN, 12.5, dur)}
  ${taper(shT, elT, 9, 7, NEAR, dur)}${taper(elT, haT, 7, 5.4, NEAR, dur)}${joint(elT, 3.8, NEAR, dur)}
  ${headQ(hdT, 1, dur)}
  ${motionCurve('M172 98 Q154 104 148 120', { w: 3.2, op: 0.6, pulse: dur })}
  ${pill(200, 142, '膝不过脚尖', { fs: 10.5, anchor: 'start', dur: 4.5, rx: 208, ry: 126 })}
  ${pill(26, 30, '下蹲先送髋：臀部向后坐，不是往前跪', { fs: 12, dur: 4.8 })}
  ${pill(26, 192, '3 组 × 12-15 次 · 大腿约与地面平行即可', { fs: 12, dur: 5.3 })}`);
};

/* ---- 15 臀桥（顶髋弧线 + 臀部发力光晕） ---- */
builds['15-glute-bridge.svg'] = () => {
  const dur = 3.2;
  const sh = pt(98, 158), hd = pt(86, 150), foot = pt(216, 168);
  const hipT = [pt(138, 160), pt(148, 128)], kneeT = [pt(186, 140), pt(190, 136)];
  const hipF = [pt(140, 162), pt(150, 130)], kneeF = [pt(190, 144), pt(193, 140)];
  const elA = pt(112, 162), haA = pt(126, 165);
  const GLOW = `<radialGradient id="gluteGlow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#58BD92" stop-opacity="0.4"/><stop offset="1" stop-color="#58BD92" stop-opacity="0"/></radialGradient>`;
  return svgFile(320, 200, `
  ${defs3(320, 200, GROUND + GLOW)}
  <rect x="0" y="0" width="320" height="200" rx="14" fill="url(#bgG)"/>
  <ellipse cx="160" cy="171" rx="70" ry="7" fill="url(#shG)" opacity="0.7"/>
  <ellipse cx="140" cy="150" rx="24" ry="16" fill="url(#gluteGlow)"><animate attributeName="cx" values="140;148;140" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/><animate attributeName="cy" values="150;124;150" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/><animate attributeName="opacity" values="0.55;1;0.55" dur="${dur}s" repeatCount="indefinite"/></ellipse>
  ${taper(hipF, kneeF, 11, 8, FAR, dur)}${taper(kneeF, [foot, foot], 8, 5.5, FAR, dur)}
  ${taper(hipT, kneeT, 12, 8.5, ACC, dur)}${taper(kneeT, [foot, foot], 8.5, 6, ACC, dur)}${joint(kneeT, 4.6, ACC, dur)}
  ${taper(hipT, [sh, sh], 19, 14, NEAR, dur)}
  ${taper([sh, sh], [elA, elA], 9, 7, NEAR)}${taper([elA, elA], [haA, haA], 7, 5.4, NEAR)}
  <circle cx="${hd.x}" cy="${hd.y}" r="9.5" fill="url(#headG)"/><circle cx="${hd.x - 3}" cy="${hd.y - 3.5}" r="2.6" fill="#FFFFFF" opacity="0.4"/>
  ${motionCurve('M158 148 Q168 116 152 102', { w: 3.2, op: 0.6, pulse: dur })}
  ${pill(26, 30, '臀桥：脚跟发力，把髋向上顶起', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '顶起时肩-髋-膝一条线 · 臀部发力 · 12-15 次 × 3 组', { fs: 12, dur: 5.2 })}`);
};

/* ---- 16 单腿硬拉（T 字） ---- */
builds['16-sl-deadlift.svg'] = () => {
  const dur = 3.4;
  // A 站立 → B 铰链：躯干前倾水平 + 后腿抬起成 T
  const A = { sh: pt(158, 66), hip: pt(154, 102), kS: pt(158, 132), fS: pt(160, 162), kB: pt(150, 132), fB: pt(148, 162) };
  const B = { sh: pt(196, 88), hip: pt(160, 104), kS: pt(166, 134), fS: pt(168, 162), kB: pt(130, 108), fB: pt(108, 96) };
  const shT = [A.sh, B.sh], hipT = [A.hip, B.hip];
  const kST = [A.kS, B.kS], fST = [A.fS, B.fS];
  const kBT = [A.kB, B.kB], fBT = [A.fB, B.fB];
  const hdT = [seg(A.sh, 268, 13), seg(B.sh, 4, 13)];
  // 手臂沿躯干下垂/前伸
  const eN = [seg(A.sh, 90 + 24, 15), seg(B.sh, 90 + 74, 15)];
  const hN = [seg(A.sh, 90 + 30, 27), seg(B.sh, 90 + 84, 27)];
  const eF = [seg(A.sh, 90 + 12, 15), seg(B.sh, 90 + 62, 15)];
  const hF = [seg(A.sh, 90 + 20, 26), seg(B.sh, 90 + 70, 26)];
  return svgFile(320, 200, `
  ${scene4(170, 164, 320, 200, { extraDefs: GROUND, shadowCx: 162, shadowRx: 34, shadowDur: 0 })}
  ${taper(eF, hF, 8.5, 6.5, FAR, dur)}
  ${taper(hipT, kBT, 11, 8, FAR, dur)}${taper(kBT, fBT, 8, 5.5, FAR, dur)}${joint(kBT, 4.4, FAR, dur)}
  ${taper(hipT, shT, 20, 15, NEAR, dur)}
  ${taper(hipT, kST, 12, 8.5, ACC, dur)}${taper(kST, fST, 8.5, 6, ACC, dur)}${joint(kST, 4.6, ACC, dur)}
  ${contour(hipT, kST, 12, dur)}
  ${taper(shT, eN, 9, 7, NEAR, dur)}${taper(eN, hN, 7, 5.4, NEAR, dur)}${joint(eN, 3.8, NEAR, dur)}
  ${headQ(hdT, 1, dur)}
  <line x1="100" y1="88" x2="196" y2="88" stroke="${MINT}" stroke-width="2" stroke-linecap="round" opacity="0.35"><animate attributeName="x1" values="150;100;150" dur="${dur}s" repeatCount="indefinite"/><animate attributeName="y1" values="70;88;70" dur="${dur}s" repeatCount="indefinite"/></line>
  ${motionCurve('M164 96 Q152 92 140 94', { w: 3, op: 0.55, pulse: dur })}
  ${pill(26, 30, '髋部向后坐，躯干与后抬腿成一条直线（T 字）', { fs: 12, dur: 4.6 })}
  ${pill(240, 112, 'T 字一条线', { fs: 10.5, anchor: 'middle', dur: 4.4 })}
  ${pill(26, 192, '动作慢、控制稳，背保持平 · 每侧 3 组 × 10 次', { fs: 12, dur: 5.2 })}`);
};

/* ---- 17 平板支撑（3/4） ---- */
builds['17-plank.svg'] = () => {
  const dur = 3.6;
  const hipT = [pt(196, 138), pt(196, 135)], shT = [pt(108, 136), pt(108, 133)];
  const hdT = [pt(88, 130), pt(88, 127)];
  // 前臂撑地
  const elN = [pt(118, 156), pt(118, 153)], haN = pt(140, 164);
  const elF = [pt(112, 158), pt(112, 155)], haF = pt(134, 166);
  // 双腿：脚尖点地
  const kF = [pt(238, 146), pt(238, 143)], fF = pt(262, 163);
  const kB = [pt(230, 148), pt(230, 145)], fB = pt(254, 165);
  return svgFile(320, 200, `
  ${scene4(170, 172, 320, 200, { extraDefs: GROUND, shadowCx: 190, shadowRx: 66, shadowDur: 0 })}
  ${taper(elF, [haF, haF], 8.5, 6.5, FAR, dur)}
  ${taper(hipT, kB, 11, 8, FAR, dur)}${taper(kB, [fB, fB], 8, 5.5, FAR, dur)}
  ${taper(hipT, shT, 20, 16, NEAR, dur)}
  ${taper(hipT, kF, 12, 8.5, ACC, dur)}${taper(kF, [fF, fF], 8.5, 6, ACC, dur)}${joint(kF, 4.6, ACC, dur)}
  ${taper(shT, elN, 9, 7, NEAR, dur)}${taper(elN, [haN, haN], 7, 5.4, NEAR, dur)}${joint(elN, 3.8, NEAR, dur)}
  ${headQ(hdT, 1, dur)}
  <line x1="90" y1="126" x2="252" y2="126" stroke="${MINT}" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
  ${motionCurve('M258 140 Q262 134 258 128', { w: 2.6, op: 0.45, head: false })}
  ${pill(226, 122, '一条直线', { fs: 10.5, anchor: 'middle', dur: 4.4, rx: 196, ry: 106 })}
  ${pill(26, 30, '肘撑于肩正下方，头-髋-脚踝一条直线', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '不塌腰、不撅臀，自然呼吸 · 3 组 × 30-60 秒', { fs: 12, dur: 5.2 })}`);
};

/* ---- 18 提踵 ---- */
builds['18-calf-raise.svg'] = () => {
  const dur = 2.6;
  const A = { sh: pt(158, 64), hip: pt(154, 100), fN: pt(158, 166), fF: pt(166, 166), toeN: pt(170, 168), toeF: pt(177, 168) };
  const B = { sh: pt(158, 56), hip: pt(154, 92), fN: pt(158, 154), fF: pt(166, 154), toeN: pt(170, 168), toeF: pt(177, 168) };
  const shT = [A.sh, B.sh], hipT = [A.hip, B.hip];
  const kN = [pt(156, 132), pt(156, 124)], kF = [pt(164, 134), pt(164, 126)];
  const hd = [pt(160, 50), pt(160, 42)];
  const eN = [pt(144, 82), pt(144, 74)], hN = [pt(140, 98), pt(140, 90)];
  const eF = [pt(172, 82), pt(172, 74)], hF = [pt(176, 98), pt(176, 90)];
  return svgFile(320, 200, `
  ${scene4(170, 166, 320, 200, { extraDefs: GROUND, shadowCx: 166, shadowRx: 26, shadowDur: 0 })}
  ${taper(eF, hF, 8.5, 6.5, FAR, dur)}
  ${taper(hipT, kF, 11, 8, FAR, dur)}${taper(kF, [A.fF, B.fF], 8, 5.5, FAR, dur)}${joint(kF, 4.4, FAR, dur)}
  ${taper(hipT, shT, 19, 15, NEAR, dur)}
  ${taper(hipT, kN, 12, 8.5, ACC, dur)}${taper(kN, [A.fN, B.fN], 8.5, 6, ACC, dur)}${joint(kN, 4.6, ACC, dur)}
  ${contour(hipT, kN, 12, dur)}
  ${taper(shT, eN, 9, 7, NEAR, dur)}${taper(eN, hN, 7, 5.4, NEAR, dur)}${joint(eN, 3.8, NEAR, dur)}
  ${headQ(hd, 1, dur)}
  ${taper([A.fN, B.fN], [A.toeN, A.toeN], 6, 4, ACC, dur)}
  <line x1="196" y1="150" x2="196" y2="160" stroke="${MINT}" stroke-width="2.4" stroke-linecap="round" opacity="0.6"><animate attributeName="y1" values="160;150;160" dur="${dur}s" repeatCount="indefinite"/></line>
  ${motionCurve('M196 146 Q202 138 196 130', { w: 2.6, op: 0.45, pulse: dur })}
  ${pill(26, 30, '脚跟尽量抬高，身体保持直立', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '缓慢起、缓慢落，不要弹 · 3 组 × 15 次', { fs: 12, dur: 5.2 })}`);
};

// ---------- 执行 ----------
const args = process.argv.slice(2);
const names = args.length ? args : Object.keys(builds).sort();
let fail = 0;
for (const n of names) {
  if (!builds[n]) { console.log(n + ': no config, skip'); continue; }
  try {
    fs.writeFileSync(path.join(DIR, n), builds[n]());
    console.log(n + ': rebuilt(v3)');
  } catch (e) { console.log(n + ': ERROR ' + e.message); fail++; }
}
console.log(fail ? ('FAILED: ' + fail) : 'all ok');
