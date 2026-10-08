// 1) 五个必做动作：删除要点列表（与卡片重复），部位标注并入图注
// 2) 05/08/09 参考图错误或缺失 → refPending 占位标记
const fs = require('fs');
const p = 'C:/Users/Lenovo/WorkBuddy/Healthy-run/public/learning.json';
let raw = fs.readFileSync(p, 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const j = JSON.parse(raw);
const FOCUS = ['臀腿综合', '激活臀部', '后链 + 平衡', '核心稳定', '小腿和跟腱'];
let fi = 0;
for (const c of j.categories) {
  for (const it of (c.items || [])) {
    if (/五个必做动作/.test(it.title)) {
      it.points = [];
      for (const m of (it.media || [])) {
        if (m.caption && FOCUS[fi]) m.caption = FOCUS[fi] + ' · ' + m.caption;
        fi++;
      }
    }
    for (const m of (it.media || [])) {
      if (/05-dyn-leg-swing|08-dyn-hip-circle|09-st-calf/.test(m.src)) {
        delete m.ref;
        m.refPending = true;
      }
    }
  }
}
fs.writeFileSync(p, JSON.stringify(j, null, 2), 'utf8');
// 校验输出
for (const c of j.categories) for (const it of (c.items || [])) {
  if (/五个必做动作/.test(it.title)) {
    console.log('points=' + (it.points || []).length);
    for (const m of (it.media || [])) console.log('T[' + m.term + '] C[' + m.caption + '] pending=' + !!m.refPending);
  }
}
for (const c of j.categories) for (const it of (c.items || [])) for (const m of (it.media || [])) {
  if (/05-|08-|09-/.test(m.src)) console.log(m.src + ' refPending=' + !!m.refPending + ' ref=' + (m.ref || 'none'));
}
