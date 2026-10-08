// 节点级耗时实测：SSE 全事件打点，输出每个节点的 elapsed_time / tokens / 输出长度
// 用来判定「慢在识图还是慢在诊断」，以及是否被思考链与超长输出拖住。
require('dotenv').config();
const fs = require('fs');
const path = require('path');
process.env.DIFY_API_KEY = fs.readFileSync(path.join(__dirname, '.dify-appkey.txt'), 'utf8').trim();
const BASE = (process.env.DIFY_BASE_URL || 'http://localhost:8180').replace(/\/+$/, '');
const { createClient } = require('@supabase/supabase-js');

const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

(async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: recs } = await supabase
    .from('run_records')
    .select('images, user_text, goal, race_date')
    .not('images', 'eq', '[]')
    .order('created_at', { ascending: false })
    .limit(1);
  if (!recs || !recs.length) return console.log('没有带图记录');
  const r = recs[0];
  console.log(`[0] ${stamp()} 图片 ${r.images.length} 张，goal=${r.goal}，发起 streaming 请求`);

  const res = await fetch(`${BASE}/v1/workflows/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.DIFY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: {
        user_text: r.user_text || '',
        goal: r.goal || 'none',
        race_date: r.race_date || '',
        history: '[]',
        images: r.images.filter(Boolean).map((url) => ({ type: 'image', transfer_method: 'remote_url', url })),
      },
      response_mode: 'streaming',
      user: 'perf-probe',
    }),
  });
  if (!res.ok) { console.log('HTTP', res.status, (await res.text()).slice(0, 300)); return; }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const seen = new Map();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const l of lines) {
      const t = l.trim();
      if (!t.startsWith('data:')) continue;
      let e; try { e = JSON.parse(t.slice(5).trim()); } catch { continue; }
      const d = e.data || {};
      if (e.event === 'node_started') {
        seen.set(e.workflow_run_id + (d.node_id || d.id), true);
        console.log(`[${stamp()}] ▶ 节点开始 ${d.title} (${d.node_type})`);
      } else if (e.event === 'node_finished') {
        const u = d.execution_metadata && d.execution_metadata.usage;
        const outLen = d.outputs ? JSON.stringify(d.outputs).length : 0;
        console.log(`[${stamp()}] ■ 节点结束 ${d.title} status=${d.status} elapsed=${d.elapsed_time ? Number(d.elapsed_time).toFixed(1) + 's' : '?'} 输出${outLen}B tokens=${u ? JSON.stringify(u) : '无'}`);
        if (d.error) console.log('     error:', String(d.error).slice(0, 300));
      } else if (e.event === 'workflow_finished') {
        console.log(`\n[${stamp()}] ⛳ 工作流结束 status=${d.status} 总耗时=${d.elapsed_time ? Number(d.elapsed_time).toFixed(1) + 's' : stamp()}`);
        const o = d.outputs || {};
        for (const k of Object.keys(o)) console.log(`    ${k}: ${typeof o[k]} len=${String(o[k]).length} 含think=${String(o[k]).includes('<think>')}`);
        fs.writeFileSync(path.join(__dirname, '.perf-probe-output.json'), JSON.stringify(o, null, 2));
      } else if (e.event === 'error') {
        console.log(`[${stamp()}] ✖ error: ${e.message} ${e.code || ''}`);
      }
    }
  }
  console.log('总墙钟耗时:', stamp());
})();
