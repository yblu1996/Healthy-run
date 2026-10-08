// 提取问题 SVG 的姿态骨架数据（静态坐标 + 动画值），用于重设计
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'public', 'learn-media', 'originals');
const files = process.argv.slice(2);
for (const f of files) {
  const s = fs.readFileSync(path.join(DIR, f), 'utf8');
  console.log('===== ' + f + ' =====');
  for (const m of s.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) {
    const t = m[0].match(/x="([\d.]+)" y="([\d.]+)"/);
    console.log('TEXT (' + t[1] + ',' + t[2] + '): ' + m[1].trim());
  }
  for (const m of s.matchAll(/<line([^>]*)>([\s\S]*?)<\/line>|<line([^>]*)\/>/g)) {
    const attrs = (m[1] || m[3] || '');
    const inner = m[2] || '';
    const g = (re) => { const r = attrs.match(re); return r ? r[1] : '?'; };
    const col = g(/stroke="(#[0-9A-Fa-f]{6})"/);
    if (col === '#D5E0DA') continue; // 地面
    const op = (attrs.match(/opacity="([\d.]+)"/) || [])[1] || '1';
    const anims = [...inner.matchAll(/<animate attributeName="(\w+)" values="([^"]+)"/g)]
      .map(a => a[1] + ':' + a[2]).join(' | ');
    console.log(
      'LINE(' + g(/x1="([\d.]+)"/) + ',' + g(/y1="([\d.]+)"/) + ')-(' + g(/x2="([\d.]+)"/) + ',' + g(/y2="([\d.]+)"/) + ')'
      + ' sw=' + g(/stroke-width="([\d.]+)"/) + ' op=' + op + ' ' + col
      + (anims ? '  ANIM ' + anims : ''));
  }
  for (const m of s.matchAll(/<circle([^>]*)>([\s\S]*?)<\/circle>/g)) {
    const attrs = m[1], inner = m[2];
    const g = (re) => { const r = attrs.match(re); return r ? r[1] : '?'; };
    const anims = [...inner.matchAll(/<animate attributeName="(\w+)" values="([^"]+)"/g)]
      .map(a => a[1] + ':' + a[2]).join(' | ');
    console.log('CIRC(' + g(/cx="([\d.]+)"/) + ',' + g(/cy="([\d.]+)"/) + ') r=' + g(/ r="([\d.]+)"/) + ' ' + g(/fill="(#[0-9A-Fa-f]{6})"/) + (anims ? '  ANIM ' + anims : ''));
  }
  const gl = s.match(/<line x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)" stroke="#2F8F6B[^/]*/);
  if (gl) console.log('GUIDE (' + gl[1] + ',' + gl[2] + ')-(' + gl[3] + ',' + gl[4] + ')');
  console.log('');
}
