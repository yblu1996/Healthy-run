const fs = require('fs');

const BASE = 'http://localhost:3210';
const out = [];

function get(path) {
  return fetch(BASE + path).then((r) => ({ status: r.status, text: () => r.text() }));
}

(async () => {
  // 1. 首页结构
  const page = await get('/');
  const html = await page.text();
  out.push('PAGE status=' + page.status);
  out.push('  view-learn: ' + html.includes('id="view-learn"'));
  out.push('  学习园地标题: ' + html.includes('科学跑步学习园地'));
  out.push('  upload-sub em 高亮: ' + html.includes('<em>速率、步频'));
  out.push('  旧文案残留: ' + (html.includes('包括速率、步频') && !html.includes('<em>')));

  // 2. learning.json 可访问且合法
  const lj = await get('/learning.json');
  out.push('learning.json status=' + lj.status);
  if (lj.status === 200) {
    const data = JSON.parse(await lj.text());
    out.push('  分类: ' + data.categories.map((c) => c.name).join('/'));
    out.push('  条目数: ' + data.categories.reduce((a, c) => a + c.items.length, 0));
  }

  // 3. renderLearn 逻辑模拟（用真实数据跑一遍字符串生成，确认不报错）
  const data = JSON.parse(fs.readFileSync(__dirname + '/public/learning.json', 'utf8'));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let rendered = 0, notes = 0;
  const html2 = data.categories.map((c) =>
    `<div class="learn-cat"><h3><span class="learn-icon">${esc(c.icon)}</span>${esc(c.name)}</h3>` +
    c.items.map((it) => {
      rendered++;
      if (it.note) notes++;
      return `<div class="learn-item"><div class="learn-head"><strong>${esc(it.title)}</strong><span class="learn-toggle"></span></div>` +
        `<div class="learn-body"><ul>${it.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` +
        (it.note ? `<p class="learn-note">⚠️ ${esc(it.note)}</p>` : '') + `</div></div>`;
    }).join('') + `</div>`
  ).join('');
  out.push('renderLearn 模拟: 渲染 ' + rendered + ' 条, 含提示 ' + notes + ' 条, 长度 ' + html2.length);

  // 4. 三码水印占位图片 HEAD 探测（文件未提供，应返回 404，代码会自动降级）
  for (const f of ['qrcode-gzh.jpg', 'qrcode-sph.jpg']) {
    const r = await get('/' + f);
    out.push(f + ' status=' + r.status + '（404 属预期，用户未提供图片）');
  }

  fs.writeFileSync(__dirname + '/.smoke4.out.txt', out.join('\n'));
})().catch((e) => {
  fs.writeFileSync(__dirname + '/.smoke4.out.txt', 'THREW: ' + e.message);
});
