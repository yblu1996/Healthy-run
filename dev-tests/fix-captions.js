// 图注去重 + 编号上移到大标题
const fs = require('fs');
const p = 'C:/Users/Lenovo/WorkBuddy/Healthy-run/public/learning.json';
let raw = fs.readFileSync(p, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const j = JSON.parse(raw);
for (const c of j.categories) {
  for (const it of (c.items || [])) {
    for (const m of (it.media || [])) {
      if (!m.caption) continue;
      let cap = m.caption.replace('（原创动画）', '');
      let num = '';
      const nm = cap.match(/^([①-⑮])\s*(.*)$/);
      if (nm) { num = nm[1]; cap = nm[2]; }
      const dm = cap.split(' · ');
      if (dm.length === 2 && dm[0].length <= 6) cap = dm[1];
      m.caption = cap;
      if (m.term && num) m.term = num + ' ' + m.term;
    }
  }
}
fs.writeFileSync(p, JSON.stringify(j, null, 2), 'utf8');
for (const c of j.categories) for (const it of (c.items || [])) for (const m of (it.media || [])) console.log('T[' + m.term + '] C[' + m.caption + ']');
