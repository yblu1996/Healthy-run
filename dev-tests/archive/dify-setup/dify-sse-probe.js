// 定位 Dify 工作流慢在哪一步：订阅全部 SSE 事件并打时间戳，
// 打印每个节点的 开始/结束/耗时，看是识图节点慢、还是诊断节点慢、还是卡住不动。
require('dotenv').config();
const fs = require('fs');
process.env.DIFY_API_KEY = fs.readFileSync(__dirname + '/.dify-appkey.txt', 'utf8').trim();

const BASE = (process.env.DIFY_BASE_URL || 'http://localhost:8180').replace(/\/+$/, '');
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: recs } = await supabase
    .from('run_records')
    .select('images, user_text')
    .eq('status', 'done')
    .not('images', 'eq', '[]')
    .order('created_at', { ascending: false })
    .limit(1);
  if (!recs || !recs.length) { console.log('NO-RECORD'); return; }
  const imgs = recs[0].images;
  console.log(`[probe] 图片数 ${imgs.length} | 发起 streaming 请求 ${stamp()}`);

  const res = await fetch(`${BASE}/v1/workflows/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: {
        user_text: recs[0].user_text || '',
        goal: 'none',
        race_date: '',
        history: '[]',
        images: imgs.filter(Boolean).map((url) => ({ type: 'image', transfer_method: 'remote_url', url })),
      },
      response_mode: 'streaming',
      user: 'run-diagnostic-platform',
    }),
  });
  if (!res.ok) { console.log('HTTP', res.status, await res.text().catch(() => '')); return; }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const started = {}; // node_execution_id -> ts
  const out = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }

      const ev = evt.event;
      const d = evt.data || {};
      if (ev === 'node_started') {
        started[d.node_execution_id] = Date.now();
        out.push(`[${stamp()}] ▶ 开始 ${d.title || d.node_id} (node=${d.node_id})`);
      } else if (ev === 'node_finished') {
        const dur = started[d.node_execution_id] ? ((Date.now() - started[d.node_execution_id]) / 1000).toFixed(1) + 's' : '?';
        const tok = d.total_tokens ? ` tokens=${d.total_tokens}` : '';
        out.push(`[${stamp()}] ✔ 完成 ${d.title || d.node_id} 耗时 ${dur}${tok}`);
        // 节点输出预览（只看前 120 字，判断节点是否产出了有效内容）
        const outs = d.outputs;
        if (outs) {
          const keys = Object.keys(outs).slice(0, 3).join(',');
          out.push(`         输出字段: ${keys || '(空)'}`);
        }
      } else if (ev === 'workflow_started') {
        out.push(`[${stamp()}] 工作流启动`);
      } else if (ev === 'workflow_finished') {
        out.push(`[${stamp()}] ■ 工作流结束 status=${d.status} 总耗时 ${d.elapsed_time}s total_tokens=${d.total_tokens}`);
        console.log(out.join('\n'));
        return;
      } else if (ev === 'error' || ev === 'workflow_failed') {
        out.push(`[${stamp()}] ✖ 错误: ${evt.message || d.error || JSON.stringify(d).slice(0, 200)}`);
        console.log(out.join('\n'));
        return;
      } else if (ev === 'text_chunk' || ev === 'agent_message' || ev === 'agent_thought') {
        // 高频事件不打全量，只标记"仍在产出"
      }
    }
  }
  console.log(out.join('\n'));
  console.log(`[probe] 流结束但无 workflow_finished ${stamp()}`);
})().catch((e) => console.log('PROBE-FAILED:', e.message));
