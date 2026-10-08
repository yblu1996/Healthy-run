/**
 * 重建问题矢量图的骨骼动画（11 张：01 02 03 04 06 07 08 09 10 11 13）
 * 统一人偶引擎：标准比例、躯干完整、手脚反相位、朝向眼点、重点肢体青绿高亮。
 * 场景/玻璃胶囊沿用升级版样式。原文件(升级前)在 originals/ 保留。
 * 用法: node rebuild-figures.js [文件名...]   无参数 = 全部重建
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'public', 'learn-media');
const ORIG = path.join(DIR, 'originals');

// ---------- 基础几何 ----------
const rad = d => d * Math.PI / 180;
const pt = (x, y) => ({ x, y });
// 从 p 沿角度 a(0=右,90=下) 走 len
const seg = (p, a, len) => pt(p.x + len * Math.cos(rad(a)), p.y + len * Math.sin(rad(a)));

// ---------- SMIL ----------
const SPL = '0.42 0 0.58 1';
function animsFor(track, n) {
  // track: {x:[...], y:[...]} 联合 keyTimes
  const out = [];
  for (const [attr, vals] of [['x1', track.x1], ['y1', track.y1], ['x2', track.x2], ['y2', track.y2]]) {
    if (vals && vals.length > 1) out.push(`<animate attributeName="${attr}" values="${vals.map(v => v.toFixed(1)).join(';')}" dur="${track.dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(vals.length - 1).fill(SPL).join(';')}"/>`);
  }
  return out.join('');
}
// 通用线：两端点各自可有 keyframes 数组
function limb(p1, p2, stroke, sw, dur, op) {
  const xs1 = Array.isArray(p1) ? p1.map(p => p.x) : null;
  const ys1 = Array.isArray(p1) ? p1.map(p => p.y) : null;
  const xs2 = Array.isArray(p2) ? p2.map(p => p.x) : null;
  const ys2 = Array.isArray(p2) ? p2.map(p => p.y) : null;
  const base1 = Array.isArray(p1) ? p1[0] : p1;
  const base2 = Array.isArray(p2) ? p2[0] : p2;
  const tr = { x1: xs1, y1: ys1, x2: xs2, y2: ys2, dur };
  return `<line x1="${base1.x.toFixed(1)}" y1="${base1.y.toFixed(1)}" x2="${base2.x.toFixed(1)}" y2="${base2.y.toFixed(1)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"${op ? ` opacity="${op}"` : ''}>${animsFor(tr)}</line>`;
}
function circleAnim(p, r, fill, dur, extra) {
  const xs = Array.isArray(p) ? p.map(q => q.x) : null;
  const ys = Array.isArray(p) ? p.map(q => q.y) : null;
  const base = Array.isArray(p) ? p[0] : p;
  let inner = '';
  for (const [attr, vals] of [['cx', xs], ['cy', ys]]) {
    if (vals) inner += `<animate attributeName="${attr}" values="${vals.map(v => v.toFixed(1)).join(';')}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${new Array(vals.length - 1).fill(SPL).join(';')}"/>`;
  }
  return `<circle cx="${base.x.toFixed(1)}" cy="${base.y.toFixed(1)}" r="${r}" fill="${fill}">${inner}${extra || ''}</circle>`;
}

// ---------- 调色（与升级版一致） ----------
const NEAR = 'url(#bodyG)', FAR = 'url(#bodyFar)', ACC = 'url(#accentG)', HEAD = 'url(#headHi)';
const TEAL = '#0F6E56', RED = '#C0392B', REDN = 'url(#redG)';

function defs(W, H) {
  return `<defs>
    <linearGradient id="bgG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDFEFD"/><stop offset="0.6" stop-color="#EEF6F1"/><stop offset="1" stop-color="#E2EEE7"/></linearGradient>
    <radialGradient id="glowG" cx="0.5" cy="0.55" r="0.55"><stop offset="0" stop-color="#BFE5D4" stop-opacity="0.8"/><stop offset="1" stop-color="#BFE5D4" stop-opacity="0"/></radialGradient>
    <linearGradient id="bodyG" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#42524B"/><stop offset="1" stop-color="#232E29"/></linearGradient>
    <linearGradient id="bodyFar" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#93A89D"/><stop offset="1" stop-color="#667C71"/></linearGradient>
    <linearGradient id="accentG" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#17A87B"/><stop offset="1" stop-color="#0F6E56"/></linearGradient>
    <linearGradient id="redG" gradientUnits="userSpaceOnUse" x1="90" y1="40" x2="240" y2="175"><stop offset="0" stop-color="#D96A57"/><stop offset="1" stop-color="#B23527"/></linearGradient>
    <radialGradient id="headHi" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#5A6A62"/><stop offset="1" stop-color="#232E29"/></radialGradient>
    <radialGradient id="headRed" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#D96A57"/><stop offset="1" stop-color="#B23527"/></radialGradient>
  </defs>`;
}

function scene(gy, cx, W, H, opt) {
  opt = opt || {};
  return `${defs(W, H)}
  <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="url(#bgG)"/>
  ${opt.noGlow ? '' : `<ellipse cx="${cx}" cy="${gy - 45}" rx="118" ry="76" fill="url(#glowG)">
    <animate attributeName="rx" values="118;126;118" dur="4.2s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
    <animate attributeName="opacity" values="0.9;1;0.9" dur="4.2s" repeatCount="indefinite"/>
  </ellipse>`}
  <path d="M12 ${gy} Q${W / 2} ${gy - 7} ${W - 12} ${gy} L${W - 12} ${gy + 6} Q${W / 2} ${gy + 13} 12 ${gy + 6} Z" fill="#DCE9E2" opacity="0.9"/>
  ${opt.shadow === false ? '' : (opt.shadowAnim
    ? `<ellipse cx="${cx}" cy="${gy - 2}" ry="5.5" fill="#B9CDC2" opacity="0.42">${opt.shadowAnim}</ellipse>`
    : `<ellipse cx="${cx}" cy="${gy - 2}" ry="5.5" fill="#B9CDC2" opacity="0.45">
    <animate attributeName="rx" values="46;37;46" dur="2.8s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
    <animate attributeName="opacity" values="0.45;0.3;0.45" dur="2.8s" repeatCount="indefinite"/>
  </ellipse>`)}
  <g fill="#2FA07C" opacity="0.6">
    <circle cx="52" cy="58" r="3"><animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" dur="5s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
    <circle cx="${W - 52}" cy="46" r="2.4" fill="#8FCDAE"><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="4.4s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
    <circle cx="${W - 32}" cy="126" r="3.2" fill="#D9A648" opacity="0.8"><animateTransform attributeName="transform" type="translate" values="0 0;0 -8;0 0" dur="5.6s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
    <circle cx="40" cy="122" r="2.2" fill="#8FCDAE"><animateTransform attributeName="transform" type="translate" values="0 0;0 -5;0 0" dur="4.8s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></circle>
  </g>`;
}

function head(p, facing, dur, red) {
  const eye = Array.isArray(p) ? p.map(q => pt(q.x + 5.2 * facing, q.y - 0.5)) : pt(p.x + 5.2 * facing, p.y - 0.5);
  const hi = Array.isArray(p) ? p.map(q => pt(q.x - 3, q.y - 3)) : pt(p.x - 3, p.y - 3);
  const base = Array.isArray(p) ? p[0] : p;
  let hiInner = '';
  if (Array.isArray(p)) {
    const sx = `values="${p.map(q => (q.x - 3).toFixed(1)).join(';')}"`;
    const sy = `values="${p.map(q => (q.y - 3).toFixed(1)).join(';')}"`;
    const sp = new Array(p.length - 1).fill(SPL).join(';');
    hiInner = `<animate attributeName="cx" ${sx} dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${sp}"/><animate attributeName="cy" ${sy} dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${sp}"/>`;
  }
  return `${circleAnim(p, 9, red ? 'url(#headRed)' : HEAD, dur)}
  ${circleAnim(eye, 1.7, '#F6FBF8', dur, `opacity="0.9"`)}
  <circle cx="${hi ? (Array.isArray(hi) ? hi[0].x : hi.x) : base.x - 3}" cy="${Array.isArray(hi) ? hi[0].y : hi.y}" r="2.6" fill="#FFFFFF" opacity="0.4">${hiInner}</circle>`;
}

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
  return `<g>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="${o.dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
    <rect x="${rxx.toFixed(1)}" y="${ryy.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="${(h / 2).toFixed(1)}" fill="#FFFFFF" opacity="0.66" stroke="#FFFFFF" stroke-width="1.2"/>
    <rect x="${rxx.toFixed(1)}" y="${ryy.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="${(h / 2).toFixed(1)}" fill="none" stroke="#D5E7DE" stroke-width="1" opacity="0.9"/>
    <text x="${x}" y="${y}" text-anchor="${o.anchor}" class="${o.cls}" font-size="${o.fs}">${text}</text>
  </g>`;
}

const STYLE = `<style>text{font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif}.lbl{fill:#5F615E;font-size:11px;font-weight:600}.pill-t{fill:#0F6E56;font-size:10.5px;font-weight:700}</style>`;

function svgFile(name, W, H, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="学习园地动作演示">
${STYLE}
${body}
</svg>
`;
}

// =====================================================================
// 各图重建配置
// =====================================================================
const builds = {};

/* ---------- 01 跑姿要点：步态周期残影（触地→缓冲→蹬伸→腾空） ---------- */
// 迷你跑者姿态参数：[髋y, 前倾, 近大腿, 近小腿, 远大腿, 远小腿, 近上臂, 远上臂]
const GAIT = {
  contact: [124, 8, 26, 6, -34, -46, 35, -35],   // 触地：前腿伸展刚落地
  load:    [128, 10, 6, -6, -46, -18, 12, -12],  // 缓冲：身体压过支撑腿，后腿折叠
  push:    [120, 14, -38, -30, 52, 28, -18, 40], // 蹬伸：支撑腿蹬直，前膝上提
  flight:  [116, 12, 58, 35, -22, -50, 42, -30]  // 腾空：腾空膝高位，后腿收折
};
function miniRunner(hx, ph, op, dur) {
  const [hy, lean, tN, sN, tF, sF, aN, aF] = GAIT[ph];
  const hip = pt(hx, hy);
  const sh = seg(hip, 270 + lean, 24);
  const hd = seg(sh, 270 + lean + 6, 11);
  const kN = seg(hip, 90 - tN, 17), fN = seg(kN, 90 - sN, 16);
  const kF = seg(hip, 90 - tF, 17), fF = seg(kF, 90 - sF, 15);
  const eN = seg(sh, 90 - aN, 10), hN = seg(eN, 90 - aN - 95, 9);
  const eF = seg(sh, 90 - aF, 10), hF = seg(eF, 90 - aF + 95, 9);
  const dyn = dur || 0;
  const A = p => (dyn ? p : p);
  return op ? `
  ${limb(eF, hF, NEAR, 7, 0, op)}
  ${limb(hip, kF, NEAR, 7.5, 0, op)}
  ${limb(kF, fF, NEAR, 7, 0, op)}
  ${limb(hip, sh, NEAR, 10, 0, op)}
  ${limb(hip, kN, NEAR, 8, 0, op)}
  ${limb(kN, fN, NEAR, 7.5, 0, op)}
  ${limb(sh, eN, NEAR, 7.5, 0, op)}
  ${limb(eN, hN, NEAR, 7, 0, op)}
  <circle cx="${hd.x}" cy="${hd.y}" r="6.5" fill="url(#headHi)" opacity="${op}"/>` : '';
}
function miniRunnerAnim(hx, dur) {
  const ph = ['contact', 'load', 'push', 'flight', 'contact'];
  const J = ph.map(k => {
    const [hy, lean, tN, sN, tF, sF, aN, aF] = GAIT[k];
    const hip = pt(hx, hy);
    const sh = seg(hip, 270 + lean, 24);
    const hd = seg(sh, 270 + lean + 6, 11);
    return {
      hip, sh, hd,
      kN: seg(hip, 90 - tN, 17), kF: seg(hip, 90 - tF, 17),
      eN: seg(sh, 90 - aN, 10), eF: seg(sh, 90 - aF, 10)
    };
  });
  const t = k => J.map(j => j[k]);
  const foot = (kk, sk) => J.map((j, i) => seg(j[kk], 90 - GAIT[ph[i]][sk], kk === 'kN' ? 16 : 15));
  const hand = (ek, ak) => J.map((j, i) => seg(j[ek], 90 - GAIT[ph[i]][ak] + (ek === 'eN' ? -95 : 95), 9));
  return `
  ${limb(t('eF'), hand('eF', 7), FAR, 7.5, dur, 0.5)}
  ${limb(t('hip'), t('kF'), FAR, 8, dur, 0.5)}
  ${limb(t('kF'), foot('kF', 5), FAR, 7.5, dur, 0.5)}
  ${limb(t('hip'), t('sh'), NEAR, 11, dur)}
  ${limb(t('hip'), t('kN'), NEAR, 8.5, dur)}
  ${limb(t('kN'), foot('kN', 3), NEAR, 8, dur)}
  ${limb(t('sh'), t('eN'), NEAR, 8, dur)}
  ${limb(t('eN'), hand('eN', 6), NEAR, 7.5, dur)}
  ${head(t('hd'), 1, dur).replace('r="9"', 'r="7.5"')}`;
}
builds['01-run-form.svg'] = () => {
  const dur = 2.8;
  const labels = [[70, '触地'], [130, '缓冲'], [190, '蹬伸'], [252, '腾空']];
  let arrows = '';
  for (const [x1, x2] of [[92, 112], [152, 172], [212, 232]]) {
    arrows += `<path d="M${x1} 112 L${x2} 112" stroke="${TEAL}" stroke-width="1.8" stroke-dasharray="5 4" opacity="0.55" stroke-linecap="round"/><path d="M${x2 - 6} 108 L${x2} 112 L${x2 - 6} 116" fill="none" stroke="${TEAL}" stroke-width="1.8" stroke-linecap="round" opacity="0.55"/>`;
  }
  let ghostHtml = '';
  ghostHtml += miniRunner(70, 'contact', 0.34);
  ghostHtml += miniRunner(130, 'load', 0.22);
  ghostHtml += miniRunner(190, 'push', 0.13);
  const body = `
  ${scene(158, 160, 320, 200)}
  ${ghostHtml}
  ${arrows}
  ${miniRunnerAnim(252, dur)}
  ${labels.map(([x, t], i) => pill(x, 190, t, { fs: 11, anchor: 'middle', dur: 4.2 + i * 0.4 })).join('\n  ')}
  ${pill(26, 30, '跑姿循环：落地在重心下方，连贯推进不刹车', { fs: 12, dur: 4.6 })}
  ${pill(268, 26, '目视前方', { fs: 10.5, anchor: 'end', dur: 5.1, rx: 208, ry: 14 })}`;
  return svgFile('01', 320, 200, body);
};

/* ---------- 02 前倾对比：左✕驼背但双腿直立(红) 右✓头-踝一条直线整体前倾 ---------- */
builds['02-run-lean.svg'] = () => {
  const dur = 3.4;
  // 左 ✕：双腿竖直站立，只有脊柱弯曲前倾（头前伸、上背圆）
  const lAnkle = pt(96, 170);
  const lHip = pt(99, 122);                       // 髋基本在脚正上方（腿直）
  const lKneeN = pt(97, 146), lFootN = pt(106, 168);   // 直腿：髋-膝-踝近乎一线
  const lKneeF = pt(104, 146), lFootF = pt(112, 168);
  const lMb = pt(108, 103);                       // 中背：前倾
  const lSh = pt(119, 92);                        // 肩更前（圆背）
  const lHead = pt(129, 83);                      // 头再前伸（下巴探出）
  const bodyL = `
  <line x1="99" y1="170" x2="99" y2="62" stroke="${RED}" stroke-width="1.8" stroke-dasharray="5 5" opacity="0.55"/>
  ${limb(pt(119, 96), pt(133, 108), REDN, 9, 0, 0.5)}
  ${limb(lHip, lKneeF, REDN, 9.5, 0, 0.5)}
  ${limb(lKneeF, lFootF, REDN, 9, 0, 0.5)}
  ${limb(lHip, lMb, REDN, 11.5, 0)}
  ${limb(lMb, lSh, REDN, 11.5, 0)}
  ${limb(lSh, pt(112, 112), REDN, 9.5, 0)}        // 近臂垂落
  ${limb(pt(112, 112), pt(118, 124), REDN, 9, 0)}
  ${limb(lHip, lKneeN, REDN, 10, 0)}
  ${limb(lKneeN, lFootN, REDN, 9.5, 0)}
  <circle cx="${lHead.x}" cy="${lHead.y}" r="8.5" fill="url(#headRed)"/>
  <circle cx="${lHead.x + 4}" cy="${lHead.y + 1}" r="1.6" fill="#FDECEA" opacity="0.9"/>
  <path d="M100 74 Q110 68 122 76" fill="none" stroke="${RED}" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.65"/>`;
  // 右 ✓：头-肩-髋-膝-踝同一条直线，整体绕踝前倾 0°→8°
  const rAnkle = pt(246, 170);
  const J = deg => {
    const A = 270 + deg; // 从踝向上的方向
    return {
      knee: seg(rAnkle, A, 30), hip: seg(rAnkle, A, 58), sh: seg(rAnkle, A, 96), hd: seg(rAnkle, A, 113),
      foot: pt(246 + 10, 168)
    };
  };
  const J0 = J(0), J1 = J(8);
  const T = k => [J0[k], J1[k]];
  const armDn = j => seg(j.sh, 90 + 8, 14);
  const handDn = j => seg(armDn(j), 90 + 10, 13);
  const shadowAnim = `<animate attributeName="rx" values="34;40;34" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/><animate attributeName="opacity" values="0.42;0.3;0.42" dur="${dur}s" repeatCount="indefinite"/>`;
  const bodyR = `
  <line x1="246" y1="168" x2="246" y2="54" stroke="${TEAL}" stroke-width="1.8" stroke-dasharray="5 5" opacity="0.6"/>
  ${limb(T('sh'), [armDn(J0), armDn(J1)], FAR, 9, dur, 0.5)}
  ${limb([armDn(J0), armDn(J1)], [handDn(J0), handDn(J1)], FAR, 8.5, dur, 0.5)}
  ${limb(T('hip'), T('knee'), NEAR, 11, dur)}
  ${limb(T('knee'), [pt(246, 170), pt(246, 170)], NEAR, 10.5, dur)}
  ${limb(T('hip'), T('sh'), NEAR, 12.5, dur)}
  ${limb(T('sh'), [seg(J0.sh, 90 - 6, 14), seg(J1.sh, 90 - 6, 14)], NEAR, 9.5, dur)}
  ${limb([seg(J0.sh, 90 - 6, 14), seg(J1.sh, 90 - 6, 14)], [seg(J0.sh, 90 - 4, 27), seg(J1.sh, 90 - 4, 27)], NEAR, 9, dur)}
  ${head(T('hd'), 1, dur)}
  <path d="M246 66 Q254 68 258 74" fill="none" stroke="${TEAL}" stroke-width="1.5" opacity="0.8"/>`;
  const body = `
  ${defs(320, 210)}
  <rect x="0" y="0" width="320" height="210" rx="14" fill="url(#bgG)"/>
  <path d="M12 174 Q160 167 308 174 L308 180 Q160 187 12 180 Z" fill="#DCE9E2" opacity="0.9"/>
  <ellipse cx="246" cy="172" ry="5" fill="#B9CDC2" opacity="0.42">${shadowAnim}</ellipse>
  <ellipse cx="102" cy="172" rx="32" ry="5" fill="#B9CDC2" opacity="0.35"/>
  ${bodyL}
  ${bodyR}
  ${pill(80, 26, '✕ 弯腰驼背（腿是直的）', { fs: 12.5, anchor: 'middle', cls: 'lbl', W: 320, H: 210, dur: 4.2 })}
  ${pill(240, 26, '✓ 全身一条直线前倾', { fs: 12.5, anchor: 'middle', W: 320, H: 210, dur: 4.8 })}
  ${pill(262, 66, '5-10°', { fs: 11, anchor: 'start', W: 320, H: 210, dur: 4.5, rx: 244, ry: 54 })}
  ${pill(26, 198, '前倾发生在脚踝：头-肩-髋-膝-踝始终一条直线', { fs: 12, W: 320, H: 210, dur: 5 })}`;
  return svgFile('02', 320, 210, body);
};

/* ---------- 03 步频节奏：同 01 骨骼（小步快频）+ 地面节奏点 ---------- */
builds['03-run-cadence.svg'] = () => {
  const dur = 1.5, F = 1;
  const hip = pt(160, 104), sh = pt(170, 66);
  const nearKnee = [seg(hip, 90 - 26, 27), seg(hip, 90 + 14, 27)];
  const nearFoot = [seg(nearKnee[0], 90 - 2, 26), seg(nearKnee[1], 90 + 44, 24)];
  const farKnee = [seg(hip, 90 + 24, 27), seg(hip, 90 - 26, 27)];
  const farFoot = [seg(farKnee[0], 90 + 50, 23), seg(farKnee[1], 90 + 0, 26)];
  const nearElbow = [seg(sh, 90 + 46, 15), seg(sh, 90 - 34, 15)];
  const nearHand = [seg(nearElbow[0], 90 - 28, 14), seg(nearElbow[1], 90 + 54, 14)];
  const farElbow = [seg(sh, 90 - 38, 15), seg(sh, 90 + 42, 15)];
  const farHand = [seg(farElbow[0], 90 + 56, 14), seg(farElbow[1], 90 - 24, 14)];
  const headP = [seg(sh, 90 - 15, 13), seg(sh, 90 - 13, 13)];
  let dots = '';
  for (let k = 0; k < 8; k++) {
    const x0 = 56 + k * 30;
    dots += `<circle cx="${x0}" cy="186" r="${k % 2 ? 2.2 : 3}" fill="${k % 2 ? '#A8C6B8' : '#0F6E56'}" opacity="0.75"><animate attributeName="cx" values="${x0};${x0 + 30}" dur="${(1.5 * (k + 2) / 4).toFixed(2)}s" repeatCount="indefinite"/></circle>`;
  }
  const body = `
  ${scene(170, 166, 320, 200)}
  ${dots}
  ${limb(farElbow, farHand, FAR, 9.5, dur, 0.55)}
  ${limb(hip, farKnee, FAR, 10, dur, 0.55)}
  ${limb(farKnee, farFoot, FAR, 9.5, dur, 0.55)}
  ${limb(hip, sh, NEAR, 13, dur)}
  ${limb(nearKnee, nearFoot, NEAR, 11, dur)}
  ${limb(hip, nearKnee, NEAR, 11, dur)}
  ${limb(sh, nearElbow, NEAR, 10.5, dur)}
  ${limb(nearElbow, nearHand, NEAR, 10, dur)}
  ${head(headP, F, dur)}
  ${pill(26, 30, '步频 170-180+/分：小步幅 · 快节奏 · 落地轻', { fs: 12, dur: 4.7 })}`;
  return svgFile('03', 320, 200, body);
};

/* ---------- 04 落地缓冲：上✕脚跟远伸(红) 下✓落在重心下方 ---------- */
builds['04-run-landing.svg'] = () => {
  // 上格（红）：跑者脚跟远伸在前，重心线落在脚后
  const top = (() => {
    const hip = pt(150, 74), sh = pt(158, 42), hd = seg(sh, 90 - 12, 13);
    const kneeF = seg(hip, 90 - 46, 27);           // 前腿膝
    const footF = seg(kneeF, 90 - 36, 26);         // 脚跟远伸
    const kneeB = seg(hip, 90 + 30, 27);
    const footB = seg(kneeB, 90 + 55, 23);
    const elN = seg(sh, 90 + 50, 15), haN = seg(elN, 90 - 30, 14);
    const elF = seg(sh, 90 - 40, 15), haF = seg(elF, 90 + 60, 14);
    return `
  <line x1="150" y1="30" x2="150" y2="96" stroke="${RED}" stroke-width="2" stroke-dasharray="4 5" opacity="0.8"/>
  ${limb(elF, haF, REDN, 9.5, 0, 0.5)}
  ${limb(hip, kneeB, REDN, 10, 0, 0.5)}
  ${limb(kneeB, footB, REDN, 9.5, 0, 0.5)}
  ${limb(hip, sh, REDN, 12, 0)}
  ${limb(sh, elN, REDN, 10.5, 0)}
  ${limb(elN, haN, REDN, 10, 0)}
  ${limb(hip, kneeF, REDN, 11, 0)}
  ${limb(kneeF, footF, REDN, 10.5, 0)}
  <circle cx="${hd.x}" cy="${hd.y}" r="9" fill="url(#headRed)"/><circle cx="${hd.x + 4.4}" cy="${hd.y - .5}" r="1.7" fill="#FDECEA" opacity=".9"/>
  <path d="M188 88 L206 84 L202 92 L212 92" fill="none" stroke="${RED}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M198 78 L206 84 L198 90" fill="none" stroke="${RED}" stroke-width="2" stroke-linecap="round"/>`;
  })();
  // 下格：脚落在重心正下方
  const bot = (() => {
    const hip = pt(150, 188), sh = pt(158, 156), hd = seg(sh, 90 - 12, 13);
    const kneeF = seg(hip, 90 - 8, 27);
    const footF = seg(kneeF, 90 + 4, 26);          // 正下方
    const kneeB = seg(hip, 90 + 30, 27);
    const footB = seg(kneeB, 90 + 55, 23);
    const elN = seg(sh, 90 + 50, 15), haN = seg(elN, 90 - 30, 14);
    const elF = seg(sh, 90 - 40, 15), haF = seg(elF, 90 + 60, 14);
    return `
  <line x1="150" y1="146" x2="150" y2="214" stroke="${TEAL}" stroke-width="2" stroke-dasharray="4 5" opacity="0.8"/>
  ${limb(elF, haF, FAR, 9.5, 0, 0.5)}
  ${limb(hip, kneeB, FAR, 10, 0, 0.5)}
  ${limb(kneeB, footB, FAR, 9.5, 0, 0.5)}
  ${limb(hip, sh, NEAR, 12, 0)}
  ${limb(sh, elN, NEAR, 10.5, 0)}
  ${limb(elN, haN, NEAR, 10, 0)}
  ${limb(hip, kneeF, ACC, 11, 0)}
  ${limb(kneeF, footF, ACC, 10.5, 0)}
  <circle cx="${hd.x}" cy="${hd.y}" r="9" fill="url(#headHi)"/><circle cx="${hd.x + 4.4}" cy="${hd.y - .5}" r="1.7" fill="#F6FBF8" opacity=".9"/>
  <path d="M148 216 Q152 210 156 216" fill="none" stroke="${TEAL}" stroke-width="2" stroke-linecap="round"/>`;
  })();
  const body = `
  ${defs(320, 230)}
  <rect x="0" y="0" width="320" height="230" rx="14" fill="url(#bgG)"/>
  <path d="M12 98 Q160 91 308 98 L308 104 Q160 111 12 104 Z" fill="#DCE9E2" opacity="0.85"/>
  <path d="M12 221 Q160 214 308 221 L308 227 Q160 228 12 227 Z" fill="#DCE9E2" opacity="0.85"/>
  <ellipse cx="150" cy="97" rx="30" ry="4.5" fill="#B9CDC2" opacity="0.4"/>
  <ellipse cx="150" cy="220" rx="34" ry="4.5" fill="#B9CDC2" opacity="0.4"/>
  ${top}
  ${bot}
  ${pill(80, 22, '✕ 脚跟远伸 = 刹车 + 冲击', { fs: 13, anchor: 'middle', cls: 'lbl', W: 320, H: 230, dur: 4.2 })}
  ${pill(80, 130, '✓ 落在重心下方 = 顺畅缓冲', { fs: 13, anchor: 'middle', W: 320, H: 230, dur: 4.9 })}
  ${pill(150, 44, '重心', { fs: 10, anchor: 'end', cls: 'lbl', W: 320, H: 230, dur: 4.4, rx: 112, ry: 32 })}
  ${pill(150, 152, '重心', { fs: 10, anchor: 'end', cls: 'lbl', W: 320, H: 230, dur: 5.2, rx: 112, ry: 140 })}`;
  return svgFile('04', 320, 230, body);
};

/* ---------- 06 弓步走：体块躯干正直，前膝不过脚尖，后膝下沉不触地，发力感 ---------- */
builds['06-dyn-lunge.svg'] = () => {
  const dur = 3;
  // 两相位：站立高位 / 下压低位。脚固定：前脚 (220,168) 后脚 (126,166)
  const A = { hip: pt(174, 116), sh: pt(173, 78) };
  const B = { hip: pt(178, 136), sh: pt(175, 98) };
  const hipT = [A.hip, B.hip], shT = [A.sh, B.sh];
  const hdT = [seg(A.sh, 268, 15), seg(B.sh, 269, 15)];
  // 前腿(青绿强调)：膝不过脚尖（膝x≤脚尖x），脚固定
  const kneeF = [pt(198, 136), pt(204, 152)];
  // 后腿(远)：膝下沉但不触地
  const kneeB = [pt(150, 144), pt(151, 158)];
  // 手叉腰（体块感）
  const elT = [seg(A.sh, 90 + 40, 15), seg(B.sh, 90 + 38, 15)];
  const haT = [pt(170, 110), pt(174, 128)];
  const elF2 = [seg(A.sh, 90 - 32, 15), seg(B.sh, 90 - 30, 15)];
  const haF2 = [pt(181, 106), pt(185, 124)];
  const body = `
  ${scene(168, 172, 320, 200)}
  <line x1="220" y1="128" x2="220" y2="164" stroke="${TEAL}" stroke-width="2" stroke-dasharray="4 5" opacity="0.85"><animate attributeName="y1" values="128;144;128" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/></line>
  ${limb(elF2, haF2, FAR, 9, dur, 0.5)}
  ${limb(hipT, kneeB, FAR, 9.5, dur, 0.5)}
  ${limb(kneeB, [pt(126, 166), pt(126, 166)], FAR, 9, dur, 0.5)}
  <path d="M148 164 Q151 160 154 164" fill="none" stroke="${TEAL}" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.7"><animate attributeName="d" values="M148 164 Q151 158 154 164;M148 164 Q151 162 154 164;M148 164 Q151 158 154 164" dur="${dur}s" repeatCount="indefinite"/></path>
  ${limb(shT, [pt(163, 78), pt(165, 98)], NEAR, 9, dur)}
  ${limb(shT, [pt(184, 78), pt(186, 98)], NEAR, 9, dur)}
  ${limb(kneeF, [pt(220, 168), pt(220, 168)], ACC, 10.5, dur)}
  ${limb(hipT, kneeF, ACC, 11, dur)}
  ${limb(hipT, shT, NEAR, 17, dur)}
  ${limb(shT, elT, NEAR, 10, dur)}
  ${limb(elT, haT, NEAR, 9.5, dur)}
  ${head(hdT, 1, dur)}
  <path d="M232 156 L246 143 M246 143 L244 151 M246 143 L238 144" stroke="${TEAL}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity="0.85"><animate attributeName="opacity" values="0.4;0.95;0.4" dur="${dur}s" repeatCount="indefinite"/></path>
  ${pill(220, 140, '膝不过脚尖', { fs: 10.5, anchor: 'start', dur: 4.5, rx: 228, ry: 124 })}
  ${pill(26, 30, '弓步走：躯干正直下压，前膝对准脚尖方向', { fs: 12, dur: 4.8 })}
  ${pill(26, 192, '每侧 8-10 次，后膝下沉但不触地', { fs: 12, dur: 5.3 })}`;
  return svgFile('06', 320, 200, body);
};

/* ---------- 07 高抬腿：体块小人（正视），膝到髋线，前脚掌落地动势 ---------- */
builds['07-dyn-high-knees.svg'] = () => {
  const dur = 1.6;
  const hipY = 100;
  // 体块躯干：圆角矩形 + 髋部横杆
  const torso = `<rect x="147" y="60" width="26" height="38" rx="12" fill="url(#bodyG)">
    <animate attributeName="y" values="60;63;60" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
  </rect>`;
  // 左右腿交替：抬起膝到髋线 y=100，落地腿支撑
  const kneeL = [pt(143, 102), pt(145, 124)];
  const footL = [pt(147, 92), pt(145, 162)];
  const kneeR = [pt(177, 124), pt(175, 102)];
  const footR = [pt(175, 162), pt(173, 92)];
  // 臂屈肘 90° 反相位
  const elL = [pt(140, 80), pt(141, 88)];
  const haL = [pt(147, 90), pt(146, 72)];
  const elR = [pt(180, 88), pt(179, 80)];
  const haR = [pt(173, 72), pt(174, 90)];
  // 落地动势：脚下箭头 + 弹起线（交替）
  const stomp = `
  <g stroke="${TEAL}" stroke-width="2.2" fill="none" stroke-linecap="round">
    <path d="M145 168 L145 176 M141 173 L145 177 L149 173" opacity="0.85"><animate attributeName="opacity" values="0.9;0.2;0.9" dur="${dur}s" repeatCount="indefinite"/></path>
    <path d="M173 168 L173 176 M169 173 L173 177 L177 173" opacity="0.2"><animate attributeName="opacity" values="0.2;0.9;0.2" dur="${dur}s" repeatCount="indefinite"/></path>
  </g>`;
  const body = `
  ${scene(166, 160, 320, 200)}
  <line x1="118" y1="100" x2="262" y2="100" stroke="${TEAL}" stroke-width="2" stroke-dasharray="4 5" opacity="0.85"/>
  ${limb([elR[0], elR[1]], [haR[0], haR[1]], FAR, 9, dur, 0.5)}
  ${limb([pt(160, 100), pt(160, 100)], [kneeR[0], kneeR[1]], FAR, 10.5, dur, 0.5)}
  ${limb([kneeR[0], kneeR[1]], [footR[0], footR[1]], FAR, 10, dur, 0.5)}
  <line x1="149" y1="100" x2="171" y2="100" stroke="url(#bodyG)" stroke-width="11" stroke-linecap="round"/>
  ${limb([kneeL[0], kneeL[1]], [footL[0], footL[1]], ACC, 10.5, dur)}
  ${limb([pt(160, 100), pt(160, 100)], [kneeL[0], kneeL[1]], ACC, 11, dur)}
  ${torso}
  ${limb([pt(160, 62), pt(160, 63)], [elL[0], elL[1]], NEAR, 9.5, dur)}
  ${limb([elL[0], elL[1]], [haL[0], haL[1]], NEAR, 9, dur)}
  <g>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 2;0 0" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
    <circle cx="160" cy="46" r="9.5" fill="url(#headHi)"/>
    <circle cx="154.8" cy="45.5" r="1.7" fill="#F6FBF8" opacity="0.92"/>
    <circle cx="165.2" cy="45.5" r="1.7" fill="#F6FBF8" opacity="0.92"/>
    <circle cx="157" cy="43" r="2.6" fill="#FFFFFF" opacity="0.4"/>
  </g>
  ${stomp}
  ${pill(268, 104, '髋部高度', { fs: 10.5, anchor: 'start', dur: 4.4, rx: 232, ry: 88 })}
  ${pill(26, 192, '膝盖抬到髋部高度，前脚掌轻快落地 · 20-30 秒', { fs: 12, dur: 5 })}`;
  return svgFile('07', 320, 200, body);
};

/* ---------- 08 髋部环绕：双手叉腰贴髋，骨盆画圈 ---------- */
builds['08-dyn-hip-circle.svg'] = () => {
  const dur = 4;
  const sh = pt(160, 60), headP = pt(160, 46);
  // 骨盆 4 相位画圈（左-前-右-后）：髋点数组
  const pelvis = [pt(154, 104), pt(160, 110), pt(166, 104), pt(160, 98)];
  const hipL = pelvis.map(p => pt(p.x - 14, p.y));
  const hipR = pelvis.map(p => pt(p.x + 14, p.y));
  // 腿：脚固定，膝随髋微动
  const kneeL = [pt(142, 132), pt(146, 136), pt(148, 132), pt(144, 128)];
  const kneeR = [pt(178, 132), pt(174, 136), pt(172, 132), pt(176, 128)];
  const footL = pt(140, 164), footR = pt(180, 164);
  // 肩/头轻微反向摆动（先定义，手臂跟随）
  const shT = [sh, pt(163, 58), sh, pt(157, 58)];
  const hdT = [headP, pt(163, 44), headP, pt(157, 44)];
  // 手臂：肩 → 肘外下 → 手贴髋角（与髋同步 4 相位）
  const elL = shT.map(s => pt(s.x - 24, s.y + 18));
  const elR = shT.map(s => pt(s.x + 24, s.y + 18));
  const haL = pelvis.map((_, i) => pt(hipL[i].x + 4, hipL[i].y - 2));
  const haR = pelvis.map((_, i) => pt(hipR[i].x - 4, hipR[i].y - 2));
  const body = `
  ${scene(170, 160, 320, 200)}
  <ellipse cx="160" cy="104" rx="26" ry="10" fill="none" stroke="${TEAL}" stroke-width="1.6" stroke-dasharray="4 4" opacity="0.7"/>
  ${limb(elL, haL, FAR, 9.5, dur, 0.5)}
  ${limb(hipL, kneeL, FAR, 10, dur, 0.5)}
  ${limb(kneeL, footL, FAR, 9.5, dur, 0.5)}
  ${limb(hipL, hipR, NEAR, 12, dur)}
  ${limb(hipR, kneeR, NEAR, 10.5, dur)}
  ${limb(kneeR, footR, NEAR, 10.5, dur)}
  ${limb(shT, elL, FAR, 9.5, dur, 0.5)}
  ${limb(shT, elR, NEAR, 10, dur)}
  ${limb(shT, hipL, NEAR, 11, dur)}
  ${limb(elR, haR, NEAR, 10, dur)}
  ${head(hdT, 1, dur)}
  ${pill(26, 26, '双手叉腰，骨盆前后左右画圈', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '上身保持稳定，膝盖随骨盆自然开合 · 每侧 8-10 圈', { fs: 12, dur: 5.2 })}`;
  return svgFile('08', 320, 200, body);
};

/* ---------- 09 小腿拉伸：侧视面朝右墙，后腿(重点)粗壮青绿 ---------- */
builds['09-st-calf.svg'] = () => {
  const dur = 3;
  // 墙在右
  const wall = `<line x1="272" y1="46" x2="272" y2="170" stroke="#B7CCC1" stroke-width="5" stroke-linecap="round"/>
  <line x1="272" y1="60" x2="264" y2="68" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/>
  <line x1="272" y1="90" x2="264" y2="98" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/>
  <line x1="272" y1="120" x2="264" y2="128" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/>
  <line x1="272" y1="150" x2="264" y2="158" stroke="#B7CCC1" stroke-width="2" stroke-linecap="round"/>`;
  // 身体前压两相位：A 直立些 / B 前压
  const shA = pt(206, 66), shB = pt(210, 70);
  const hipA = pt(200, 108), hipB = pt(204, 110);
  const shT = [shA, shB], hipT = [hipA, hipB];
  const hdT = [seg(shA, 90 - 10, 13), seg(shB, 90 - 8, 13)];
  // 双手扶墙（固定），手臂随肩动
  const haN = pt(264, 76), haF = pt(266, 88);
  const elN = [seg(haN, 180, 15), seg(haN, 184, 15)];
  const elF = [seg(haF, 184, 15), seg(haF, 188, 15)];
  // 前腿(远)：膝弯向前下
  const kneeF = [pt(224, 134), pt(226, 136)];
  const footF = pt(240, 166);
  // 后腿(近,青绿重点)：从髋向后下蹬直，脚跟踩地
  const kneeB = [pt(180, 136), pt(182, 137)];
  const heelB = [pt(158, 166), pt(158, 166)];
  const body = `
  ${scene(170, 232, 320, 200)}
  ${wall}
  <line x1="206" y1="120" x2="164" y2="160" stroke="${TEAL}" stroke-width="2" stroke-dasharray="4 5" opacity="0.85"/>
  ${limb(elF, [haF, haF], FAR, 9.5, dur, 0.5)}
  ${limb(hipT, kneeF, FAR, 10, dur, 0.5)}
  ${limb(kneeF, footF, FAR, 9.5, dur, 0.5)}
  ${limb(hipT, shT, NEAR, 12.5, dur)}
  ${limb(shT, elN, NEAR, 10.5, dur)}
  ${limb(elN, [haN, haN], NEAR, 10, dur)}
  ${limb(hipT, kneeB, ACC, 11, dur)}
  ${limb(kneeB, heelB, ACC, 10.5, dur)}
  ${head(hdT, 1, dur)}
  ${pill(150, 132, '后腿蹬直', { fs: 10.5, anchor: 'end', dur: 4.5 })}
  ${pill(26, 192, '后腿伸直、脚跟踩地，身体缓慢前压 · 每侧 20-30 秒', { fs: 12, dur: 5 })}`;
  return svgFile('09', 320, 200, body);
};

/* ---------- 10 股四头肌拉伸：站立，支撑腿粗壮，拉脚腿青绿 ---------- */
builds['10-st-quad.svg'] = () => {
  const dur = 3.2;
  const sh = pt(158, 64), hip = pt(154, 100), hd = seg(sh, 90 - 6, 13);
  // 支撑腿(近)：竖直踩地
  const footS = pt(156, 168);
  // 拉起腿(青绿)：膝向下、脚跟拉向臀部，微动
  const kneeQ = [pt(168, 128), pt(170, 126)];
  const footQ = [pt(176, 104), pt(178, 101)];
  // 后手抓脚（近侧），前手扶墙/叉腰（远侧垂下）
  const elB = [pt(178, 90), pt(180, 88)];
  const haB = footQ;
  const elF = seg(sh, 90 + 20, 15), haF = seg(elF, 90 + 12, 14);
  const body = `
  ${scene(170, 156, 320, 200)}
  ${limb(elF, haF, FAR, 9.5, 0, 0.5)}
  ${limb(hip, footS, FAR, 10, 0, 0.5)}
  ${limb(hip, sh, NEAR, 12.5, 0)}
  ${limb(sh, elB, NEAR, 10.5, dur)}
  ${limb(elB, haB, NEAR, 10, dur)}
  ${limb(hip, kneeQ, ACC, 11, dur)}
  ${limb(kneeQ, footQ, ACC, 10.5, dur)}
  ${head(hd, 1, 0)}
  ${pill(26, 30, '手抓脚背拉向臀部，膝盖指向正下方', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '大腿前侧有牵拉感即可，髋部微微前送 · 每侧 20-30 秒', { fs: 12, dur: 5.2 })}`;
  return svgFile('10', 320, 200, body);
};

/* ---------- 11 腘绳肌拉伸：坐姿前倾，背直从髋折叠 ---------- */
builds['11-st-hamstring.svg'] = () => {
  const dur = 3.6;
  const sit = pt(148, 162);          // 坐骨
  const foot = pt(224, 164);         // 脚(腿沿地)
  // 两相位：直立坐 / 前倾抓脚
  const shA = pt(136, 116), shB = pt(160, 130);
  const shT = [shA, shB];
  const hdT = [seg(shA, 90 - 24, 13), seg(shB, 90 - 16, 13)];
  const elT = [seg(shA, 90 - 18, 15), seg(shB, 90 - 14, 15)];
  const haT = [pt(166, 128), pt(198, 146)];
  const elF = [seg(shA, 90 - 4, 15), seg(shB, 90 - 6, 15)];
  const haF = [pt(158, 140), pt(190, 154)];
  const knee = pt(186, 162); // 腿微曲膝(近直线)
  const body = `
  ${scene(170, 172, 320, 200)}
  ${limb(elF, haF, FAR, 9.5, dur, 0.5)}
  ${limb([sit, sit], [knee, knee], FAR, 10, dur, 0.5)}
  ${limb([knee, knee], [foot, foot], FAR, 9.5, dur, 0.5)}
  ${limb([sit, sit], shT, NEAR, 12.5, dur)}
  ${limb(shT, elT, NEAR, 10.5, dur)}
  ${limb(elT, haT, NEAR, 10, dur)}
  ${limb([sit, sit], [knee, knee], NEAR, 11, dur)}
  ${limb([knee, knee], [foot, foot], ACC, 10.5, dur)}
  ${head(hdT, 1, dur)}
  ${pill(210, 150, '腿伸直', { fs: 10.5, anchor: 'start', dur: 4.4, rx: 218, ry: 136 })}
  ${pill(26, 30, '坐姿，背挺直、从髋部前倾够向脚尖', { fs: 12, dur: 4.8 })}
  ${pill(26, 192, '大腿后侧有牵拉感即可，不要弓背 · 20-30 秒', { fs: 12, dur: 5.4 })}`;
  return svgFile('11', 320, 200, body);
};

/* ---------- 13 臀肌拉伸：仰卧拉膝，贴地腿粗壮 ---------- */
builds['13-st-glute.svg'] = () => {
  const dur = 3.4;
  const hip = pt(140, 166);
  const sh = pt(96, 166);              // 仰卧:肩在地面
  const hd = pt(84, 158);              // 头侧放
  // 贴地腿(近,粗)：沿地面伸直
  const footG = pt(214, 163);
  // 拉起腿(青绿):膝拉向胸口 两相位
  const kneeT = [pt(112, 148), pt(106, 142)];
  const footT = [pt(146, 138), pt(140, 130)];
  // 双手拉膝（前后两条臂，手贴膝）
  const elN = [pt(112, 152), pt(106, 146)], haN = kneeT;
  const elF = [pt(116, 156), pt(110, 150)], haF = kneeT;
  const body = `
  ${scene(170, 158, 320, 200)}
  ${limb(elF, haF, FAR, 9.5, dur, 0.5)}
  ${limb(hip, footG, NEAR, 11, 0)}
  ${limb(hip, kneeT, ACC, 11, dur)}
  ${limb(kneeT, footT, ACC, 10.5, dur)}
  ${limb(hip, sh, NEAR, 12.5, 0)}
  ${limb(sh, elN, NEAR, 10.5, dur)}
  ${limb(elN, haN, NEAR, 10, dur)}
  ${circleAnim(hd, 9, HEAD, 0)}
  <circle cx="${hd.x + 3}" cy="${hd.y - 4}" r="2.6" fill="#FFFFFF" opacity="0.4"/>
  ${pill(26, 30, '仰卧，双手把一侧膝盖拉向胸口', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '另一条腿放松伸直贴地 · 每侧 20-30 秒', { fs: 12, dur: 5.2 })}`;
  return svgFile('13', 320, 200, body);
};

/* ---------- 14 深蹲：下蹲先送髋、臀部向后坐，膝不过脚尖 ---------- */
builds['14-squat.svg'] = () => {
  const dur = 3.2;
  // 站立 A → 下蹲 B：髋向后(-24)向下，躯干前倾，膝只微前移（不过脚尖）
  const A = { hip: pt(168, 106), sh: pt(172, 68) };
  const B = { hip: pt(146, 126), sh: pt(176, 94) };
  const hipT = [A.hip, B.hip], shT = [A.sh, B.sh];
  const hdT = [seg(A.sh, 272, 14), seg(B.sh, 278, 14)];
  const footN = pt(200, 168);                       // 前脚固定（朝右）
  const kneeN = [pt(178, 138), pt(190, 142)];       // 膝微前移，胫骨保持接近垂直
  const kneeF = [pt(170, 140), pt(181, 145)];
  const footF = pt(190, 168);
  // 手臂前平举配重（下蹲时抬起）
  const elT = [seg(A.sh, 90 + 70, 15), seg(B.sh, 90 + 82, 15)];
  const haT = [seg(A.sh, 90 + 96, 28), seg(B.sh, 90 + 94, 29)];
  const elF = [seg(A.sh, 90 + 40, 15), seg(B.sh, 90 + 62, 15)];
  const haF = [seg(A.sh, 90 + 58, 27), seg(B.sh, 90 + 80, 27)];
  const body = `
  ${scene(170, 176, 320, 200)}
  <line x1="200" y1="130" x2="200" y2="164" stroke="${TEAL}" stroke-width="2" stroke-dasharray="4 5" opacity="0.8"/>
  <path d="M170 100 Q152 106 148 122" fill="none" stroke="${TEAL}" stroke-width="2" stroke-dasharray="5 4" opacity="0.8" stroke-linecap="round"/>
  <path d="M148 122 L143 120 M148 122 L149 116" stroke="${TEAL}" stroke-width="2" stroke-linecap="round" opacity="0.8" fill="none"/>
  ${limb(elF, haF, FAR, 9, dur, 0.5)}
  ${limb(hipT, kneeF, FAR, 10, dur, 0.5)}
  ${limb(kneeF, [footF, footF], FAR, 9.5, dur, 0.5)}
  ${limb(shT, [pt(161, 68), pt(165, 94)], NEAR, 9, dur)}
  ${limb(shT, [pt(183, 68), pt(187, 94)], NEAR, 9, dur)}
  ${limb(hipT, shT, NEAR, 17, dur)}
  ${limb(hipT, kneeN, ACC, 11, dur)}
  ${limb(kneeN, [footN, footN], ACC, 10.5, dur)}
  ${limb(shT, elT, NEAR, 10, dur)}
  ${limb(elT, haT, NEAR, 9.5, dur)}
  ${head(hdT, 1, dur)}
  ${pill(200, 142, '膝不过脚尖', { fs: 10.5, anchor: 'start', dur: 4.5, rx: 208, ry: 126 })}
  ${pill(26, 30, '下蹲先送髋：臀部向后坐，不是往前跪', { fs: 12, dur: 4.8 })}
  ${pill(26, 192, '3 组 × 12-15 次 · 大腿约与地面平行即可', { fs: 12, dur: 5.3 })}`;
  return svgFile('14', 320, 200, body);
};

/* ---------- 15 臀桥：髋向上顶起弧线箭头 + 臀部发力高亮 ---------- */
builds['15-glute-bridge.svg'] = () => {
  const dur = 3.2;
  // A 髋落地 → B 髋顶起（肩-髋-膝一条线）
  const sh = pt(98, 158);                                    // 肩贴地
  const hd = pt(86, 150);                                    // 头侧放
  const hipT = [pt(138, 160), pt(148, 128)];
  const kneeT = [pt(186, 140), pt(190, 136)];
  const foot = pt(216, 168);                                 // 脚踩地固定
  const hipF = [pt(140, 162), pt(150, 130)];
  const kneeF = [pt(190, 144), pt(193, 140)];
  // 手臂平放地面
  const elA = pt(112, 162), haA = pt(126, 165);
  const body = `
  ${scene(170, 162, 320, 200)}
  <defs>
    <radialGradient id="gluteGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#17A87B" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#17A87B" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="140" cy="150" rx="22" ry="15" fill="url(#gluteGlow)">
    <animate attributeName="cx" values="140;148;140" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
    <animate attributeName="cy" values="150;124;150" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${SPL};${SPL}"/>
    <animate attributeName="opacity" values="0.55;1;0.55" dur="${dur}s" repeatCount="indefinite"/>
  </ellipse>
  <path d="M156 150 Q166 116 152 102" fill="none" stroke="${TEAL}" stroke-width="2.4" stroke-dasharray="6 5" stroke-linecap="round" opacity="0.9">
    <animate attributeName="opacity" values="0.35;0.95;0.35" dur="${dur}s" repeatCount="indefinite"/>
  </path>
  <path d="M152 102 L146 106 M152 102 L155 110" stroke="${TEAL}" stroke-width="2.4" stroke-linecap="round" fill="none" opacity="0.9">
    <animate attributeName="opacity" values="0.35;0.95;0.35" dur="${dur}s" repeatCount="indefinite"/>
  </path>
  ${limb(hipF, kneeF, FAR, 10, dur, 0.5)}
  ${limb(kneeF, [foot, foot], FAR, 9.5, dur, 0.5)}
  ${limb(hipT, kneeT, ACC, 11, dur)}
  ${limb(kneeT, [foot, foot], ACC, 10.5, dur)}
  ${limb(hipT, [sh, sh], NEAR, 15, dur)}
  ${limb([sh, sh], [elA, elA], NEAR, 9.5, 0)}
  ${limb([elA, elA], [haA, haA], NEAR, 9, 0)}
  <circle cx="${hd.x}" cy="${hd.y}" r="9" fill="url(#headHi)"/>
  <circle cx="${hd.x - 3}" cy="${hd.y - 3}" r="2.6" fill="#FFFFFF" opacity="0.4"/>
  ${pill(26, 30, '臀桥：脚跟发力，把髋向上顶起', { fs: 12, dur: 4.6 })}
  ${pill(26, 192, '顶起时肩-髋-膝一条线 · 臀部发力 · 12-15 次 × 3 组', { fs: 12, dur: 5.2 })}`;
  return svgFile('15', 320, 200, body);
};

// ---------- 执行 ----------
const args = process.argv.slice(2);
const names = args.length ? args : Object.keys(builds);
for (const n of names) {
  if (!builds[n]) { console.log(n + ': no build config, skip'); continue; }
  fs.writeFileSync(path.join(DIR, n), builds[n]());
  console.log(n + ': rebuilt');
}
console.log('done');
