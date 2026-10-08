const fs = require('fs'), path = require('path');
const problems = [];
try {
  const html = fs.readFileSync('public/index.html', 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/g)].map(m => m[1]).filter(u => !u.startsWith('http') && !u.startsWith('data:'));
  for (const r of refs) { const p = path.join('public', r); if (!fs.existsSync(p)) problems.push('index.html missing: ' + r); }
  const app = fs.readFileSync('public/app.js', 'utf8');
  for (const m of app.matchAll(/(vendor\/[a-z0-9.-]+|qrcode-[a-z-]+\.jpg|learning\.json)/g)) {
    if (!fs.existsSync(path.join('public', m[0]))) problems.push('app.js missing: ' + m[0]);
  }
  const lj = JSON.parse(fs.readFileSync('public/learning.json', 'utf8'));
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      for (const k of ['src', 'ref', 'image']) if (typeof n[k] === 'string' && !n[k].startsWith('data:')) {
        if (!fs.existsSync(path.join('public', n[k]))) problems.push('learning.json missing: ' + n[k]);
      }
      Object.values(n).forEach(walk);
    }
  })(lj);
  for (const f of ['terms.html', 'privacy.html', 'disclaimer.html']) if (!fs.existsSync(path.join('public/legal', f))) problems.push('legal missing: ' + f);
  const code = fs.readFileSync('api/index.js', 'utf8') + fs.readFileSync('lib/dify.js', 'utf8') + fs.readFileSync('lib/coze.js', 'utf8') + fs.readFileSync('lib/auth.js', 'utf8');
  const envUsed = new Set([...code.matchAll(/process\.env\.([A-Z_]+)/g)].map(m => m[1]));
  const envEx = fs.readFileSync('.env.example', 'utf8');
  for (const k of envUsed) { if (!envEx.includes(k)) problems.push('.env.example lacks: ' + k); }
  const dify = fs.readFileSync('lib/dify.js', 'utf8');
  for (const v of ['user_text', 'goal', 'race_date', 'history', 'images']) if (!dify.includes(v)) problems.push('lib/dify.js lacks var: ' + v);
} catch (e) { problems.push('CHECK-ERROR: ' + e.message); }
console.log(problems.length ? problems.join('\n') : 'RESOURCE-CHECK-OK');
