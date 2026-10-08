/**
 * 学习园地示意动图生成器 v2（原创矢量动画，非第三方素材）
 *
 * v2 重做要点（用户反馈：手脚比例失调、不美观、髋部绕环四肢分家、要看图领会训练要点）：
 *  1. 人体比例模板：头半径8.5 / 躯干34 / 大腿31 / 小腿31 / 上臂21 / 前臂21，
 *     所有姿势共用同一副骨长 —— 每条骨骼在每一帧的长度都校验，偏差>18% 控制台告警。
 *  2. joint() 两圆交点自动求膝/肘：姿势只给两端关节，中间关节按骨长解算，
 *     物理上杜绝"骨头被拉长"的变形。
 *  3. 髋部绕环改为正视图（双手叉腰、骨盆画圈、上身稳定），不再用抽象俯视图。
 *  4. 关键动作加训练要点标注：膝对脚尖（深蹲/弓步）、髋部高度（高抬腿）、
 *     后腿直线（小腿拉伸）、T 字线（单腿硬拉）、一条直线（平板）、5-10° 前倾角弧等。
 *
 * 产出 public/learn-media/*.svg。改姿势/节奏改本文件再跑：node dev-tests/gen-learn-media.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'learn-media');

/* ============ 配色（与应用主题一致） ============ */
const INK = '#33413A';
const ACCENT = '#2F8F6B';
const RED = '#D0533F';
const GROUND = '#D5E0DA';
const LABEL = '#7E8C85';
const GUIDE = '#AFC5BA';
const FONT = `text{font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;}`;

/* ============ 人体比例模板 ============ */
const HEAD_R = 8.5;
const THIGH = 31;
const SHIN = 31;
const UA = 21;   // 上臂
const FA = 21;   // 前臂
const TORSO = 38; // 躯干零件是 颈→髋（含颈椎段）
const SHOULDER_W = 44; // 正视肩宽
const HIP_W = 24;      // 正视髋宽
const FOOT = 13;

// 标准侧视站立（面朝右），地面 y=170；覆盖某关节用 opts
function stand(cx, opts = {}) {
  return {
    head: [cx, 50], neck: [cx, 60], shoulder: [cx, 64], hip: [cx, 98],
    ankleF: [cx, 159], toeF: [cx + 11, 162],
    ankleB: [cx + 2, 159], toeB: [cx + 13, 162],
    handF: [cx - 2, 104], handB: [cx + 4, 104],
    ...opts,
  };
}

// 两圆交点求中间关节：a、b 为两端关节，la/lb 为两段骨长，
// dir=+1 关节凸向 (dy,-dx) 方向，-1 凸向反向
function joint(a, b, la, lb, dir = 1) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const d = Math.hypot(dx, dy) || 0.01;
  const aa = (la * la - lb * lb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, la * la - aa * aa));
  const mx = a[0] + dx * aa / d, my = a[1] + dy * aa / d;
  return [mx + dir * dy * h / d, my - dir * dx * h / d];
}

// 由端关节补全膝/肘；端关节缺失时跳过（单腿/特殊姿势可能只给部分肢体）
function solve(p, { bendF = 1, bendB = 1, elbowF = -1, elbowB = 1 } = {}) {
  const q = { ...p };
  if (p.ankleF) q.kneeF = joint(p.hip, p.ankleF, THIGH, SHIN, bendF);
  if (p.ankleB) q.kneeB = joint(p.hip, p.ankleB, THIGH, SHIN, bendB);
  if (p.handF) q.elbowF = joint(p.shoulder, p.handF, UA, FA, elbowF);
  if (p.handB) q.elbowB = joint(p.shoulder, p.handB, UA, FA, elbowB);
  return q;
}

/* ============ 渲染 ============ */
function round(v) { return Math.round(v * 10) / 10; }

// 骨长模板：按"远端关节名"匹配
function boneTemplate(p) {
  const b = p.b, a = p.a;
  if (/^knee/.test(b)) return THIGH;
  if (/^ankle/.test(b)) return /^knee/.test(a) ? SHIN : null;
  if (/^toe/.test(b)) return FOOT;
  if (/^elbow/.test(b)) return UA;
  if (/^hand/.test(b)) return /^elbow/.test(a) ? FA : null;
  if (b === 'hip') return TORSO;
  if (/^shoulder[LRE]?$/.test(b) && /^shoulder/.test(a)) return SHOULDER_W;
  if (/^hip[LRE]?$/.test(b) && /^hip/.test(a)) return HIP_W;
  return null;
}

function bodyFrag(cfg) {
  // 脚长自动归一：所有 ankle→toe 线段统一为 FOOT 长（骨架刚体，杜绝脚被拉长/缩短）
  const frames = cfg.frames.map((f) => {
    const g = { ...f };
    for (const p of cfg.parts) {
      if (/^toe/.test(p.b) && /^ankle/.test(p.a) && f[p.a] && f[p.b]) {
        const a = f[p.a], t = f[p.b];
        const dx = t[0] - a[0], dy = t[1] - a[1];
        const d = Math.hypot(dx, dy) || 0.01;
        g[p.b] = [a[0] + dx / d * FOOT, a[1] + dy / d * FOOT];
      }
    }
    return g;
  });
  const cycle = [...frames, frames[0]];
  const kf = cycle.map((_, i) => (i / (cycle.length - 1)).toFixed(4)).join(';');
  const spl = Array(cycle.length - 1).fill('0.42 0 0.58 1').join(';');
  const dur = cfg.dur || '2.8s';
  const vals = (j, k) => cycle.map((f) => (f[j] ? f[j][k] : null));
  const same = (arr) => arr.every((v) => v === arr[0]);
  function animStr(name, arr) {
    if (same(arr)) return { attr: round(arr[0]), anim: '' };
    return {
      attr: round(arr[0]),
      anim: `<animate attributeName="${name}" values="${arr.map(round).join(';')}" keyTimes="${kf}" dur="${dur}" repeatCount="indefinite" calcMode="spline" keySplines="${spl}"/>`,
    };
  }
  const out = [];
  // 防线：parts 引用的关节必须在帧里有坐标，否则报错（undefined 会渲染成 (0,0) 的超长斜线）
  for (const p of cfg.parts) {
    for (const f of frames) {
      if (!f[p.a] || !f[p.b]) throw new Error(`${cfg.name || '?'}: 关节缺失 ${p.a}->${p.b} (${f[p.a] ? '' : p.a} ${f[p.b] ? '' : p.b})`);
    }
    const x1 = animStr('x1', vals(p.a, 0));
    const y1 = animStr('y1', vals(p.a, 1));
    const x2 = animStr('x2', vals(p.b, 0));
    const y2 = animStr('y2', vals(p.b, 1));
    const style = `stroke="${p.color || INK}" stroke-width="${p.sw || 5}" stroke-linecap="round"${p.op && p.op < 1 ? ` opacity="${p.op}"` : ''}`;
    out.push(`<line x1="${x1.attr}" y1="${y1.attr}" x2="${x2.attr}" y2="${y2.attr}" ${style}>${x1.anim}${y1.anim}${x2.anim}${y2.anim}</line>`);
  }
  if (cfg.head) {
    const cx = animStr('cx', vals(cfg.head, 0));
    const cy = animStr('cy', vals(cfg.head, 1));
    out.push(`<circle cx="${cx.attr}" cy="${cy.attr}" r="${HEAD_R}" fill="${cfg.headColor || INK}">${cx.anim}${cy.anim}</circle>`);
  }
  let frag = out.join('\n  ');
  lintBones(cfg, frames);
  if (cfg.wrapRotate) {
    const r = cfg.wrapRotate;
    frag = `<g><animateTransform attributeName="transform" type="rotate" values="${r.values}" dur="${r.dur || dur}" repeatCount="indefinite" calcMode="spline" keySplines="${Array(r.values.split(';').length - 1).fill('0.42 0 0.58 1').join(';')}"/>${frag}</g>`;
  }
  if (cfg.scale) {
    const [factor, cx, cy] = cfg.scale;
    frag = `<g transform="translate(${cx} ${cy}) scale(${factor}) translate(${-cx} ${-cy})">${frag}</g>`;
  }
  if (cfg.translate) frag = `<g transform="translate(${cfg.translate[0]},${cfg.translate[1]})">${frag}</g>`;
  return frag;
}

// 骨长校验：每条骨骼在每一帧的长度对模板的偏差（用归一后的帧）
function lintBones(cfg, frames) {
  if (!cfg.name) return;
  const warns = [];
  for (const p of cfg.parts) {
    const t = boneTemplate(p);
    if (!t) continue;
    frames: for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (!f[p.a] || !f[p.b]) continue;
      const len = Math.hypot(f[p.a][0] - f[p.b][0], f[p.a][1] - f[p.b][1]);
      if (Math.abs(len - t) > t * 0.18) {
        warns.push(`${p.a}-${p.b} 帧${i + 1} 长度${len.toFixed(1)}≠${t}`);
        break frames;
      }
    }
  }
  if (warns.length) console.log(`  [lint] ${cfg.name}: ${warns.join('；')}`);
}

let currentFigureTitle = '';
function doc(w, h, inner, title = currentFigureTitle) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}">
<title>${title}</title>
<style>${FONT}</style>
<rect x="0" y="0" width="${w}" height="${h}" rx="12" fill="#F8FBF9"/>
${inner}
</svg>
`;
}

const ground = (y = 170, x1 = 24, x2 = 296) =>
  `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${GROUND}" stroke-width="3" stroke-linecap="round"/>`;

const flowingGround = (y = 170) =>
  `<line x1="24" y1="${y}" x2="296" y2="${y}" stroke="${GROUND}" stroke-width="4" stroke-linecap="round" stroke-dasharray="18 14"><animate attributeName="stroke-dashoffset" from="32" to="0" dur="0.9s" repeatCount="indefinite"/></line>`;

const marchArrow = (x1, y1, x2, y2, color = ACCENT) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.5" stroke-dasharray="7 6" marker-end="url(#ah)"><animate attributeName="stroke-dashoffset" from="13" to="0" dur="0.8s" repeatCount="indefinite"/></line>`;

const arrowDefs = () =>
  `<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${ACCENT}"/></marker></defs>`;

const label = (x, y, t, color = LABEL, size = 12, anchor = 'start') =>
  `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" text-anchor="${anchor}" font-weight="600">${t}</text>`;

const guide = (x1, y1, x2, y2, color = ACCENT) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-dasharray="4 5" opacity="0.85"/>`;

/* 侧视骨架零件：B=远侧肢体（半透明造纵深），F=近侧 */
const SIDE_PARTS = [
  { a: 'neck', b: 'hip', sw: 6 },
  { a: 'shoulder', b: 'elbowB', op: 0.38, sw: 4.5 }, { a: 'elbowB', b: 'handB', op: 0.38, sw: 4.5 },
  { a: 'hip', b: 'kneeB', op: 0.38, sw: 4.5 }, { a: 'kneeB', b: 'ankleB', op: 0.38, sw: 4.5 }, { a: 'ankleB', b: 'toeB', sw: 4, op: 0.38 },
  { a: 'shoulder', b: 'elbowF' }, { a: 'elbowF', b: 'handF' },
  { a: 'hip', b: 'kneeF' }, { a: 'kneeF', b: 'ankleF' }, { a: 'ankleF', b: 'toeF', sw: 4 },
];

/* ============ 跑步循环：4 关键帧，双腿相位差半圈 ============ */
const RUN_HIP = [[158, 103], [158, 100], [158, 103], [158, 100]];
const RUN_ANKLE_F = [
  [197, 143], // A 触地（身前）
  [169, 155], // B 支撑（重心下）
  [115, 141], // C 蹬伸（身后）
  [166, 121], // D 折叠前摆
];
const RUN_TOE_F = [
  [209, 149], [181, 159], [107, 150], [156, 130],
];
function runFrames() {
  const head = [171, 52], neck = [166, 64], shoulder = [167, 68];
  return RUN_HIP.map((hip, i) => {
    const ankleF = RUN_ANKLE_F[i];
    const ankleB = RUN_ANKLE_F[(i + 2) % 4];
    const forward = i < 2;
    return solve({
      head, neck, shoulder, hip,
      ankleF, toeF: RUN_TOE_F[i],
      ankleB, toeB: RUN_TOE_F[(i + 2) % 4],
      handF: forward ? [195, 98] : [139, 98],
      handB: forward ? [139, 98] : [195, 98],
    }, { bendF: 1, bendB: 1, elbowF: -1, elbowB: 1 });
  });
}

const FIGS = [];

/* ---------- 01 全身跑姿循环 ---------- */
FIGS.push({
  file: '01-run-form.svg', title: '正确跑姿循环示意',
  render() {
    return doc(320, 200, `
  ${arrowDefs()}
  ${flowingGround()}
  ${marchArrow(184, 36, 250, 28)}
  ${label(256, 26, '目视前方', ACCENT)}
  ${bodyFrag({ name: '01', frames: runFrames(), parts: SIDE_PARTS, head: 'head', dur: '0.95s' })}
  ${label(26, 192, '躯干微前倾 · 肘约 90° · 落地轻快', ACCENT)}`);
  },
});

/* ---------- 02 从脚踝前倾（对比） ---------- */
FIGS.push({
  file: '02-run-lean.svg', title: '躯干前倾来自脚踝（对比）',
  render() {
    const bad = solve({
      head: [125, 66], neck: [118, 78], shoulder: [115, 84], hip: [85, 103],
      ankleF: [85, 159], toeF: [96, 162],
      ankleB: [88, 159], toeB: [99, 162],
      handF: [102, 112], handB: [96, 114],
    }, { bendF: 1, bendB: 1, elbowF: -1, elbowB: 1 });
    const good = solve(stand(238));
    return doc(320, 210, `
  ${ground(174)}
  <line x1="160" y1="36" x2="160" y2="196" stroke="${GUIDE}" stroke-width="2" stroke-dasharray="4 5"/>
  ${label(80, 28, '✕ 弯腰驼背', RED, 13, 'middle')}
  ${label(240, 28, '✓ 从脚踝前倾', ACCENT, 13, 'middle')}
  ${bodyFrag({
    name: '02-bad', frames: [bad],
    parts: SIDE_PARTS.map((p) => ({ ...p, color: RED })),
    head: 'head', headColor: RED,
  })}
  ${bodyFrag({
    name: '02-good', frames: [good],
    parts: SIDE_PARTS,
    head: 'head',
    wrapRotate: { values: '0 238 159; -9 238 159; 0 238 159', dur: '3.2s' },
  })}
  <line x1="238" y1="100" x2="238" y2="48" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="4 5"/>
  <path d="M 238,54 A 101 101 0 0 1 253.7,55.2" fill="none" stroke="${ACCENT}" stroke-width="2"/>
  ${label(258, 66, '5-10°', ACCENT, 13)}
  ${label(26, 198, '前倾从脚踝开始，脊柱从头到脚保持一条直线', LABEL)}`);
  },
});

/* ---------- 03 步频节奏 ---------- */
FIGS.push({
  file: '03-run-cadence.svg', title: '高步频小步幅示意',
  render() {
    return doc(320, 200, `
  ${flowingGround()}
  ${bodyFrag({ name: '03', frames: runFrames(), parts: SIDE_PARTS, head: 'head', dur: '0.68s' })}
  ${Array.from({ length: 9 }, (_, i) => `<circle cx="${56 + i * 26}" cy="188" r="3" fill="${GUIDE}"/>`).join('')}
  <circle cy="188" r="4.5" fill="${ACCENT}"><animate attributeName="cx" values="${Array.from({ length: 9 }, (_, i) => 56 + i * 26).join(';')}" calcMode="discrete" dur="0.68s" repeatCount="indefinite"/></circle>
  ${label(26, 26, '步频 170-180+/分：小步幅 · 快节奏 · 落地轻', ACCENT)}`);
  },
});

/* ---------- 04 着地点对比 ---------- */
FIGS.push({
  file: '04-run-landing.svg', title: '着地点与重心关系对比',
  render() {
    const bad = solve({
      head: [162, 28], neck: [159, 39], shoulder: [158, 43], hip: [152, 74],
      ankleF: [204, 94], toeF: [216, 88],
      ankleB: [122, 80], toeB: [114, 88],
      handF: [141, 74], handB: [178, 76],
    }, { bendF: -1, bendB: 1, elbowF: 1, elbowB: -1 });
    const good = solve({
      head: [162, 113], neck: [159, 124], shoulder: [158, 128], hip: [152, 159],
      ankleF: [166, 217], toeF: [178, 220],
      ankleB: [118, 207], toeB: [110, 201],
      handF: [141, 159], handB: [170, 161],
    }, { bendF: 1, bendB: 1, elbowF: 1, elbowB: -1 });
    return doc(320, 230, `
  ${ground(98, 24, 296)}
  ${ground(221, 24, 296)}
  ${label(80, 20, '✕ 脚跟远伸 = 刹车 + 冲击', RED, 13, 'middle')}
  ${label(80, 128, '✓ 落在重心下方 = 顺畅缓冲', ACCENT, 13, 'middle')}
  ${guide(155, 32, 155, 94, RED)}
  ${guide(155, 140, 155, 217)}
  ${label(150, 42, '重心', RED, 10.5, 'end')}
  ${label(150, 150, '重心', ACCENT, 10.5, 'end')}
  ${bodyFrag({
    name: '04-bad', frames: [bad],
    parts: SIDE_PARTS.map((p) => ({ ...p, color: RED })),
    head: 'head', headColor: RED,
  })}
  <g><path d="M224,66 l6,7 -5,2 7,8" fill="none" stroke="${RED}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><animate attributeName="opacity" values="1;0.15;1" dur="1s" repeatCount="indefinite"/></path></g>
  ${bodyFrag({ name: '04-good', frames: [good], parts: SIDE_PARTS, head: 'head' })}`);
  },
});

/* ---------- 05 腿部前后摆动（扶墙） ---------- */
FIGS.push({
  file: '05-dyn-leg-swing.svg', title: '腿部前后摆动（动态热身）',
  render() {
    const base = {
      head: [174, 52], neck: [173, 64], shoulder: [173, 68], hip: [170, 102],
      ankleS: [170, 164], toeS: [181, 167],
      elbowF: [196, 66], handF: [218, 64],
    };
    const frame = (ankleM, toeM) => ({
      ...base, ankleM, toeM,
      elbowB: joint(base.shoulder, [176, 106], UA, FA, 1),
      handB: [176, 106],
      kneeS: joint(base.hip, base.ankleS, THIGH, SHIN, 1),
      kneeM: joint(base.hip, ankleM, THIGH, SHIN, 1),
    });
    return doc(320, 200, `
  ${ground()}
  <line x1="243" y1="28" x2="243" y2="170" stroke="${GROUND}" stroke-width="5" stroke-linecap="round"/>
  <line x1="236" y1="28" x2="236" y2="170" stroke="${GROUND}" stroke-width="2" stroke-linecap="round"/>
  ${bodyFrag({
    name: '05',
    frames: [frame([212, 146], [222, 148]), frame([128, 148], [118, 152])],
    parts: [
      { a: 'neck', b: 'hip', sw: 6 },
      { a: 'shoulder', b: 'elbowB', op: 0.38, sw: 4.5 }, { a: 'elbowB', b: 'handB', op: 0.38, sw: 4.5 },
      { a: 'shoulder', b: 'elbowF' }, { a: 'elbowF', b: 'handF' },
      { a: 'hip', b: 'kneeS', op: 0.38, sw: 4.5 }, { a: 'kneeS', b: 'ankleS', op: 0.38, sw: 4.5 }, { a: 'ankleS', b: 'toeS', sw: 4, op: 0.38 },
      { a: 'hip', b: 'kneeM', color: ACCENT }, { a: 'kneeM', b: 'ankleM', color: ACCENT }, { a: 'ankleM', b: 'toeM', sw: 4, color: ACCENT },
    ],
    head: 'head', dur: '2.2s',
  })}
  ${label(26, 30, '扶墙侧立，摆动腿伸直前后摆', ACCENT)}
  ${label(26, 192, '各 10-15 次，幅度由小到大，膝盖不弯', ACCENT)}`);
  },
});

/* ---------- 06 弓步走 ---------- */
FIGS.push({
  file: '06-dyn-lunge.svg', title: '弓步走（动态热身）',
  render() {
    // 弓步走：躯干正直（颈-髋保持模板 38），前膝由解算得出，后腿伸直后点地
    const frame = (hy) => {
      const p = {
        head: [182, hy - 49], neck: [182, hy - 38], shoulder: [182, hy - 30], hip: [185, hy],
        ankleF: [211, 170], toeF: [223, 172],
        ankleB: [138, 160], toeB: [128, 164],
        handF: [196, hy - 8], handB: [184, hy - 8],
      };
      return {
        ...p,
        kneeF: joint(p.hip, p.ankleF, THIGH, SHIN, 1),
        kneeB: joint(p.hip, p.ankleB, THIGH, SHIN, -1),
        elbowF: joint(p.shoulder, p.handF, UA, FA, -1),
        elbowB: joint(p.shoulder, p.handB, UA, FA, 1),
      };
    };
    const A = frame(104);
    const B = frame(130);
    return doc(320, 200, `
  ${arrowDefs()}
  ${ground()}
  ${marchArrow(236, 186, 286, 186)}
  ${guide(211, 132, 211, 166)}
  ${label(190, 156, '膝对脚尖', ACCENT, 10.5)}
  ${bodyFrag({ name: '06', frames: [A, B], parts: SIDE_PARTS, head: 'head', dur: '2.4s' })}
  ${label(26, 26, '躯干正直下压，前膝对准脚尖方向', ACCENT)}
  ${label(26, 192, '每侧 8-10 次，后膝下沉但不触地', ACCENT)}`);
  },
});

/* ---------- 07 高抬腿 ---------- */
FIGS.push({
  file: '07-dyn-high-knees.svg', title: '高抬腿（动态热身）',
  render() {
    const base = { head: [158, 50], neck: [158, 62], shoulder: [158, 66], hip: [158, 100] };
    const frame = (frontUp) => solve({
      ...base,
      ankleF: frontUp ? [184, 128] : [157, 162],
      toeF: frontUp ? [195, 132] : [169, 165],
      ankleB: frontUp ? [157, 162] : [184, 128],
      toeB: frontUp ? [169, 165] : [195, 132],
      handF: frontUp ? [136, 100] : [182, 100],
      handB: frontUp ? [182, 100] : [136, 100],
    }, { bendF: 1, bendB: 1, elbowF: -1, elbowB: 1 });
    return doc(320, 200, `
  ${flowingGround()}
  ${guide(122, 100, 258, 100)}
  ${label(264, 104, '髋部高度', ACCENT, 10.5)}
  ${bodyFrag({
    name: '07',
    frames: [frame(true), frame(false)],
    parts: SIDE_PARTS.map((p) => (/^(kneeF|ankleF|toeF|kneeB|ankleB|toeB)$/.test(p.b) ? { ...p, color: ACCENT } : p)),
    head: 'head', dur: '0.7s',
  })}
  ${label(26, 192, '左右交替抬膝到髋部高度，前脚掌轻快落地 · 20-30 秒', ACCENT)}`);
  },
});

/* ---------- 08 髋部绕环（正视，双手叉腰，骨盆画圈） ---------- */
FIGS.push({
  file: '08-dyn-hip-circle.svg', title: '髋部绕环（动态热身，正视）',
  render() {
    // 正视图：肩线/头稳定，双脚固定，骨盆带圈（±8, ±4）；肘与膝全部由骨长解算
    const hipPos = [[8, 0], [0, 4], [-8, 0], [0, -3]]; // 右 → 下 → 左 → 上
    const frames = hipPos.map(([dx, dy]) => {
      const hipL = [148 + dx, 106 + dy], hipR = [172 + dx, 106 + dy];
      const handL = [hipL[0] - 3, hipL[1] - 2], handR = [hipR[0] + 3, hipR[1] - 2];
      return {
        head: [160, 46], neck: [160, 56],
        shoulderL: [138, 68], shoulderR: [182, 68],
        hipL, hipR, handL, handR,
        elbowL: joint([138, 68], handL, UA, FA, -1),
        elbowR: joint([182, 68], handR, UA, FA, 1),
        ankleL: [146, 162], toeL: [133, 164],
        ankleR: [174, 162], toeR: [187, 164],
        kneeL: joint(hipL, [146, 162], THIGH, SHIN, -1),
        kneeR: joint(hipR, [174, 162], THIGH, SHIN, 1),
      };
    });
    return doc(320, 200, `
  ${arrowDefs()}
  ${ground()}
  <ellipse cx="160" cy="103" rx="15" ry="8" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-dasharray="4 4"/>
  <path d="M 176,98 A 16 9 0 0 1 172,109" fill="none" stroke="${ACCENT}" stroke-width="2.5" marker-end="url(#ah)"/>
  ${bodyFrag({
    name: '08',
    frames,
    parts: [
      { a: 'shoulderL', b: 'shoulderR', sw: 6 },
      { a: 'neck', b: 'shoulderL', sw: 5 }, { a: 'neck', b: 'shoulderR', sw: 5 },
      { a: 'shoulderL', b: 'hipL', sw: 5 }, { a: 'shoulderR', b: 'hipR', sw: 5 },
      { a: 'hipL', b: 'hipR', sw: 5 },
      { a: 'shoulderL', b: 'elbowL', sw: 4.5 }, { a: 'elbowL', b: 'handL', sw: 4.5 },
      { a: 'shoulderR', b: 'elbowR', sw: 4.5 }, { a: 'elbowR', b: 'handR', sw: 4.5 },
      { a: 'hipL', b: 'kneeL' }, { a: 'kneeL', b: 'ankleL' }, { a: 'ankleL', b: 'toeL', sw: 4 },
      { a: 'hipR', b: 'kneeR' }, { a: 'kneeR', b: 'ankleR' }, { a: 'ankleR', b: 'toeR', sw: 4 },
    ],
    head: 'head', dur: '2.6s',
  })}
  ${label(26, 26, '双手叉腰，骨盆前后左右画圈', ACCENT)}
  ${label(26, 192, '上身保持稳定，膝盖随骨盆自然开合 · 每侧 8-10 圈', ACCENT)}`);
  },
});

/* ---------- 09 小腿拉伸（推墙） ---------- */
FIGS.push({
  file: '09-st-calf.svg', title: '小腿拉伸（跑后静态）',
  render() {
    const mk = (hx) => solve({
      head: [hx + 10, 50], neck: [hx + 8, 62], shoulder: [hx + 6, 66], hip: [hx, 102],
      ankleF: [hx + 12, 160], toeF: [hx + 24, 164],
      ankleB: [197, 160], toeB: [207, 164],
      handF: [hx + 46, 63], handB: [hx + 48, 71],
    }, { bendF: 1, bendB: 1, elbowF: 1, elbowB: -1 });
    const A = mk(218), B = mk(222);
    return doc(320, 200, `
  ${ground()}
  <line x1="278" y1="30" x2="278" y2="170" stroke="${GROUND}" stroke-width="5" stroke-linecap="round"/>
  <line x1="271" y1="30" x2="271" y2="170" stroke="${GROUND}" stroke-width="2" stroke-linecap="round"/>
  ${guide(218, 96, 191, 158)}
  ${label(186, 130, '后腿蹬直', ACCENT, 10.5, 'end')}
  ${bodyFrag({
    name: '09',
    frames: [A, B],
    parts: SIDE_PARTS.map((p) => (/^(ankleB|kneeB|hip-$|hip$)/.test(p.a) || /^(kneeB|ankleB|toeB)$/.test(p.b) || (p.a === 'hip' && /B/.test(p.b)) ? { ...p, color: ACCENT } : p)),
    head: 'head', dur: '3.2s',
  })}
  ${label(26, 192, '后腿伸直、脚跟踩地，身体缓慢前压 · 每侧 20-30 秒', ACCENT)}`);
  },
});

/* ---------- 10 股四头肌拉伸 ---------- */
FIGS.push({
  file: '10-st-quad.svg', title: '股四头肌拉伸（跑后静态）',
  render() {
    const base = stand(155);
    // 站姿抱脚背：脚背拉到髋高度，膝解算向后凸；肘随抓握手解算（parts 里不能出现未定义关节）
    const frame = (ax, ay) => {
      const ankleQ = [ax, ay], handQ = [ax + 3, ay - 2], handF = [172, 90];
      return {
        ...base, ankleQ, toeQ: [ax - 12, ay - 4], handQ, handF,
        kneeF: joint(base.hip, base.ankleF, THIGH, SHIN, 1),
        kneeQ: joint(base.hip, ankleQ, THIGH, SHIN, 1),
        elbowQ: joint(base.shoulder, handQ, UA, FA, 1),
        elbowF: joint(base.shoulder, handF, UA, FA, -1),
      };
    };
    return doc(320, 200, `
  ${ground()}
  ${bodyFrag({
    name: '10',
    frames: [frame(140, 102), frame(135, 98)],
    parts: [
      { a: 'neck', b: 'hip', sw: 6 },
      { a: 'shoulder', b: 'elbowF', op: 0.38, sw: 4.5 }, { a: 'elbowF', b: 'handF', op: 0.38, sw: 4.5 },
      { a: 'shoulder', b: 'elbowQ' }, { a: 'elbowQ', b: 'handQ' },
      { a: 'hip', b: 'kneeF', op: 0.38, sw: 4.5 }, { a: 'kneeF', b: 'ankleF', op: 0.38, sw: 4.5 }, { a: 'ankleF', b: 'toeF', sw: 4, op: 0.38 },
      { a: 'hip', b: 'kneeQ', color: ACCENT }, { a: 'kneeQ', b: 'ankleQ', color: ACCENT }, { a: 'ankleQ', b: 'toeQ', sw: 4, color: ACCENT },
    ],
    head: 'head', dur: '3.2s',
  })}
  ${label(26, 30, '手抓脚背拉向臀部，膝盖指向正下方', ACCENT)}
  ${label(26, 192, '大腿前侧有牵拉感即可，髋部微微前送 · 每侧 20-30 秒', ACCENT)}`);
  },
});

/* ---------- 11 腘绳肌拉伸（坐姿体前屈） ---------- */
FIGS.push({
  file: '11-st-hamstring.svg', title: '腘绳肌拉伸（跑后静态）',
  render() {
    const legFixed = {
      kneeL: [171, 164], ankleL: [202, 163], toeL: [212, 161],
      kneeL2: [170, 167], ankleL2: [201, 166], toeL2: [211, 164],
    };
    const frame = (head, neck, shoulder, handF, handB) => ({
      head, neck, shoulder, hip: [140, 166], handF, handB, ...legFixed,
      elbowF: joint(shoulder, handF, UA, FA, 1),
      elbowB: joint(shoulder, handB, UA, FA, 1),
    });
    return doc(320, 200, `
  ${ground()}
  ${guide(139, 130, 205, 156)}
  ${label(210, 148, '腿伸直', ACCENT, 10.5)}
  ${bodyFrag({
    name: '11',
    frames: [
      frame([136, 116], [138, 128], [139, 130], [168, 142], [166, 148]),
      frame([184, 146], [172, 148], [172, 150], [196, 150], [194, 156]),
    ],
    parts: [
      { a: 'neck', b: 'hip', sw: 6 },
      { a: 'shoulder', b: 'elbowB', op: 0.38, sw: 4.5 }, { a: 'elbowB', b: 'handB', op: 0.38, sw: 4.5 },
      { a: 'shoulder', b: 'elbowF' }, { a: 'elbowF', b: 'handF' },
      { a: 'hip', b: 'kneeL2', op: 0.38, sw: 4.5 }, { a: 'kneeL2', b: 'ankleL2', op: 0.38, sw: 4.5 },
      { a: 'hip', b: 'kneeL' }, { a: 'kneeL', b: 'ankleL' }, { a: 'ankleL', b: 'toeL', sw: 4 },
    ],
    head: 'head', dur: '3.4s',
  })}
  ${label(26, 30, '坐姿，背挺直、从髋部前倾够向脚尖', ACCENT)}
  ${label(26, 192, '大腿后侧有牵拉感即可，不要弓背 · 20-30 秒', ACCENT)}`);
  },
});

/* ---------- 12 髋屈肌拉伸（半跪姿） ---------- */
FIGS.push({
  file: '12-st-hipflexor.svg', title: '髋屈肌拉伸（跑后静态，半跪姿）',
  render() {
    const frame = (hx, hy, sy) => solve({
      head: [hx - 3, sy - 17], neck: [hx - 3, sy - 8], shoulder: [hx - 3, sy], hip: [hx, hy],
      ankleF: [184, 170], toeF: [196, 172],
      ankleB: [120, 168], toeB: [110, 170],
      handF: [172, sy + 31], handB: [138, sy + 33],
    }, { bendF: 1, bendB: 1, elbowF: -1, elbowB: 1 });
    const A = frame(150, 139, 105);
    const B = frame(155, 143, 109);
    return doc(320, 200, `
  ${arrowDefs()}
  ${ground()}
  ${marchArrow(166, 118, 200, 132)}
  ${bodyFrag({ name: '12', frames: [A, B], parts: SIDE_PARTS, head: 'head', dur: '3.2s' })}
  ${label(26, 30, '半跪姿：髋部向前下方送，收紧臀部', ACCENT)}
  ${label(26, 192, '感受大腿前侧 / 髋前侧牵拉 · 每侧 20-30 秒', ACCENT)}`);
  },
});

/* ---------- 13 臀部拉伸（仰卧抱膝） ---------- */
FIGS.push({
  file: '13-st-glute.svg', title: '臀部拉伸（跑后静态，仰卧抱膝）',
  render() {
    const fixed = { kneeFlat: [162, 166], ankleFlat: [193, 166], toeFlat: [203, 164] };
    const frame = (kp, ap, tp, h1, h2) => ({
      head: [84, 158], neck: [91, 161], shoulder: [96, 163], hip: [130, 166],
      kneePull: kp, anklePull: ap, toePull: tp, handF: h1, handB: h2, ...fixed,
      elbowF: joint([96, 163], h1, UA, FA, -1),
      elbowB: joint([96, 163], h2, UA, FA, -1),
    });
    return doc(320, 200, `
  ${ground(150)}
  ${bodyFrag({
    name: '13',
    frames: [
      frame([108, 142], [82, 152], [74, 146], [106, 150], [104, 154]),
      frame([106, 142], [78, 152], [70, 146], [102, 148], [100, 152]),
    ],
    parts: [
      { a: 'neck', b: 'hip', sw: 6 },
      { a: 'shoulder', b: 'elbowB', op: 0.38, sw: 4.5 }, { a: 'elbowB', b: 'handB', op: 0.38, sw: 4.5 },
      { a: 'shoulder', b: 'elbowF' }, { a: 'elbowF', b: 'handF' },
      { a: 'hip', b: 'kneeFlat', op: 0.38, sw: 4.5 }, { a: 'kneeFlat', b: 'ankleFlat', op: 0.38, sw: 4.5 }, { a: 'ankleFlat', b: 'toeFlat', sw: 4, op: 0.38 },
      { a: 'hip', b: 'kneePull', color: ACCENT }, { a: 'kneePull', b: 'anklePull', color: ACCENT }, { a: 'anklePull', b: 'toePull', sw: 4, color: ACCENT },
    ],
    head: 'head', dur: '3.4s', scale: [1.65, 140, 160], translate: [0, -20],
  })}
  ${label(26, 30, '仰卧，双手把一侧膝盖拉向胸口', ACCENT)}
  ${label(26, 192, '另一条腿放松伸直贴地 · 每侧 20-30 秒', ACCENT)}`);
  },
});

/* ---------- 14 深蹲 ---------- */
FIGS.push({
  file: '14-squat.svg', title: '深蹲（力量训练）',
  render() {
    const A = solve(stand(155, { handF: [147, 106], handB: [163, 106] }));
    const B = solve({
      head: [161, 84], neck: [159, 96], shoulder: [158, 100], hip: [137, 126],
      ankleF: [155, 158], toeF: [166, 161],
      ankleB: [158, 158], toeB: [169, 161],
      handF: [196, 104], handB: [194, 110],
    }, { bendF: 1, bendB: 1, elbowF: 1, elbowB: -1 });
    return doc(320, 200, `
  ${ground()}
  ${guide(175, 122, 175, 158)}
  ${label(180, 144, '膝对脚尖', ACCENT, 10.5)}
  ${bodyFrag({ name: '14', frames: [A, B, B], parts: SIDE_PARTS, head: 'head', dur: '3.1s' })}
  ${label(26, 30, '臀部向后坐，膝盖对准脚尖方向、不内扣', ACCENT)}
  ${label(26, 192, '3 组 × 12-15 次 · 大腿约与地面平行即可', ACCENT)}`);
  },
});

/* ---------- 15 臀桥 ---------- */
FIGS.push({
  file: '15-glute-bridge.svg', title: '臀桥（力量训练）',
  render() {
    // 躺姿几何：颈/头沿肩→髋轴线延伸（平躺时躯干线才等于模板长）；
    // 顶起时肩-髋-膝一条斜线，膝由小腿垂直反推（ankle 固定）
    const A = (() => {
      const shoulder = [106, 162], hip = [138, 164];
      const ux = (hip[0] - shoulder[0]) / 38, uy = (hip[1] - shoulder[1]) / 38;
      const neck = [shoulder[0] - ux * 4, shoulder[1] - uy * 4];
      const head = [neck[0] - ux * 11, neck[1] - uy * 11];
      const kneeF = [163, 143], ankleF = [172, 170];
      const handF = [122, 166];
      return { head, neck, shoulder, hip, kneeF, ankleF, toeF: [184, 171], handF,
        kneeB: [160, 146], ankleB: [169, 172], toeB: [181, 172],
        handB: [120, 170],
        elbowF: joint(shoulder, handF, UA, FA, -1),
        elbowB: joint(shoulder, [120, 170], UA, FA, -1) };
    })();
    const B = (() => {
      const shoulder = [106, 160], hip = [138, 140];
      const kneeF = [169, 140], ankleF = [172, 170];
      const handF = [122, 164];
      return { head: [95, 165], neck: [102, 162], shoulder, hip, kneeF, ankleF, toeF: [184, 171], handF,
        kneeB: [166, 143], ankleB: [169, 172], toeB: [181, 172],
        handB: [120, 168],
        elbowF: joint(shoulder, handF, UA, FA, -1),
        elbowB: joint(shoulder, [120, 168], UA, FA, -1) };
    })();
    return doc(320, 200, `
  ${arrowDefs()}
  ${ground(150)}
  ${marchArrow(150, 126, 150, 102)}
  ${bodyFrag({
    name: '15',
    frames: [A, B, B],
    parts: [
      { a: 'neck', b: 'hip', sw: 6 },
      { a: 'shoulder', b: 'elbowB', op: 0.38, sw: 4.5 }, { a: 'elbowB', b: 'handB', op: 0.38, sw: 4.5 },
      { a: 'shoulder', b: 'elbowF' }, { a: 'elbowF', b: 'handF' },
      { a: 'hip', b: 'kneeB', op: 0.38, sw: 4.5 }, { a: 'kneeB', b: 'ankleB', op: 0.38, sw: 4.5 }, { a: 'ankleB', b: 'toeB', sw: 4, op: 0.38 },
      { a: 'hip', b: 'kneeF', color: ACCENT }, { a: 'kneeF', b: 'ankleF' }, { a: 'ankleF', b: 'toeF', sw: 4 },
    ],
    head: 'head', dur: '3.2s', scale: [1.65, 145, 160], translate: [0, -24],
  })}
  ${label(26, 30, '脚跟踩实，用臀部把髋顶起来', ACCENT)}
  ${label(26, 192, '顶端夹紧臀部停 1 秒再放下 · 3 组 × 15 次', ACCENT)}`);
  },
});

/* ---------- 16 单腿硬拉 ---------- */
FIGS.push({
  file: '16-sl-deadlift.svg', title: '单腿硬拉（力量训练）',
  render() {
    const A = (() => {
      const p = stand(152, { handF: [145, 106], handB: [159, 106], ankleM: [155, 159], toeM: [166, 162] });
      return { ...solve(p), kneeM: joint(p.hip, p.ankleM, THIGH, SHIN, 1) };
    })();
    const B = (() => {
      const p = {
        head: [102, 108], neck: [114, 112], shoulder: [116, 116], hip: [152, 102],
        ankleF: [152, 159], toeF: [163, 162],
        ankleM: [212, 116], toeM: [222, 120],
        handF: [112, 144], handB: [116, 146],
      };
      return { ...solve(p, { bendF: 1, bendB: 1, elbowF: 1, elbowB: -1 }), kneeM: joint(p.hip, p.ankleM, THIGH, SHIN, -1) };
    })();
    return doc(320, 200, `
  ${ground()}
  ${guide(96, 114, 232, 114)}
  ${label(238, 118, 'T 字一条线', ACCENT, 10.5)}
  ${bodyFrag({
    name: '16',
    frames: [A, B, B],
    parts: [
      { a: 'neck', b: 'hip', sw: 6 },
      { a: 'shoulder', b: 'elbowB', op: 0.38, sw: 4.5 }, { a: 'elbowB', b: 'handB', op: 0.38, sw: 4.5 },
      { a: 'shoulder', b: 'elbowF' }, { a: 'elbowF', b: 'handF' },
      { a: 'hip', b: 'kneeF', op: 0.38, sw: 4.5 }, { a: 'kneeF', b: 'ankleF', op: 0.38, sw: 4.5 }, { a: 'ankleF', b: 'toeF', sw: 4, op: 0.38 },
      { a: 'hip', b: 'kneeM', color: ACCENT }, { a: 'kneeM', b: 'ankleM', color: ACCENT }, { a: 'ankleM', b: 'toeM', sw: 4, color: ACCENT },
    ],
    head: 'head', dur: '3.4s',
  })}
  ${label(26, 30, '髋部向后坐，躯干与后抬腿成一条直线（T 字）', ACCENT)}
  ${label(26, 192, '动作慢、控制稳，背保持平 · 每侧 3 组 × 10 次', ACCENT)}`);
  },
});

/* ---------- 17 平板支撑 ---------- */
FIGS.push({
  file: '17-plank.svg', title: '平板支撑（力量训练）',
  render() {
    const mk = (dy) => ({
      head: [124, 133 + dy], neck: [136, 137 + dy], shoulder: [150, 139 + dy],
      elbow: [150, 160], hand: [171, 161],
      hip: [184, 141 + dy], knee: [216, 155 + dy], ankle: [247, 157 + dy], toe: [252, 169],
    });
    return doc(320, 200, `
  ${ground(150)}
  ${guide(123, 109, 274, 127)}
  ${label(238, 100, '一条直线', ACCENT, 10.5)}
  ${bodyFrag({
    name: '17',
    frames: [mk(0), mk(-3)],
    parts: [
      { a: 'neck', b: 'shoulder', sw: 6 }, { a: 'shoulder', b: 'hip', sw: 6 },
      { a: 'hip', b: 'knee', sw: 6 }, { a: 'knee', b: 'ankle', sw: 6 },
      { a: 'shoulder', b: 'elbow' }, { a: 'elbow', b: 'hand' },
      { a: 'ankle', b: 'toe', sw: 4 },
    ],
    head: 'head', dur: '3.4s', scale: [1.35, 185, 150], translate: [0, -23],
  })}
  ${label(26, 30, '肘撑于肩正下方，头-髋-脚踝一条直线', ACCENT)}
  ${label(26, 192, '不塌腰、不撅臀，自然呼吸 · 3 组 × 30-60 秒', ACCENT)}`);
  },
});

/* ---------- 18 提踵 ---------- */
FIGS.push({
  file: '18-calf-raise.svg', title: '提踵（力量训练）',
  render() {
    const A = solve(stand(155, { handF: [148, 106], handB: [162, 106] }));
    const B = solve(stand(157, {
      head: [159, 51], neck: [159, 61], shoulder: [159, 65], hip: [159, 99],
      handF: [152, 103], handB: [166, 103],
      ankleF: [155, 160], toeF: [167, 170],
      ankleB: [158, 160], toeB: [170, 170],
    }));
    return doc(320, 200, `
  ${arrowDefs()}
  ${ground()}
  ${marchArrow(200, 56, 200, 32)}
  ${bodyFrag({ name: '18', frames: [A, B, B], parts: SIDE_PARTS, head: 'head', dur: '2.7s' })}
  ${label(26, 30, '脚跟尽量抬高，身体保持直立', ACCENT)}
  ${label(26, 192, '缓慢起、缓慢落，不要弹 · 3 组 × 15 次', ACCENT)}`);
  },
});

/* ============ 输出 ============ */
fs.mkdirSync(OUT, { recursive: true });
for (const f of FIGS) {
  currentFigureTitle = f.title;
  fs.writeFileSync(path.join(OUT, f.file), f.render());
  console.log('written', f.file);
}
console.log(`\n${FIGS.length} figures -> ${OUT}`);
