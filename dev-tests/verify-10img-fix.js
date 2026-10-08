// 端到端验证"10 张图片诊断不再被超时误杀"：
// 1) 用历史成功记录里的 10 张图片直连本地 Dify 发起 streaming 请求；
// 2) 给每个 SSE 事件打时间戳，重点看最长事件间隔（>180s 就会被新的空闲超时误杀）；
// 3) 记录总耗时与最终状态。
// 用法：node dev-tests/verify-10img-fix.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const BASE = (process.env.DIFY_BASE_URL || 'http://localhost:8180').replace(/\/+$/, '');
const IDLE_MS = Number(process.env.DIFY_IDLE_TIMEOUT_MS) || 180 * 1000;
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
let lastEventAt = Date.now();
let maxGapMs = 0;

(async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  // 取最近一条 10 图的成功记录，复用它的真实图片地址
  const { data: recs } = await supabase
    .from('run_records')
    .select('images, user_text, goal')
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(20);
  const rec = (recs || []).find((r) => (r.images || []).length === 10);
  if (!rec) { console.log('NO-10IMG-RECORD'); return; }
  console.log(`[probe ${stamp()}] 使用 ${rec.images.length} 张历史图片发起请求`);

  const res = await fetch(`${BASE}/v1/workflows/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: {
        user_text: rec.user_text || '',
        goal: rec.goal || 'none',
        race_date: '',
        history: '[]',
        images: rec.images.filter(Boolean).map((url) => ({ type: 'image', transfer_method: 'remote_url', url })),
      },
      response_mode: 'streaming',
      user: 'verify-10img-fix',
    }),
  });
  if (!res.ok) { console.log(`[probe ${stamp()}] HTTP ${res.status}:`, await res.text().catch(() => '')); return; }
  console.log(`[probe ${stamp()}] 流已建立，开始接收事件`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const nodeStart = {};
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
      const gap = Date.now() - lastEventAt;
      if (gap > maxGapMs) maxGapMs = gap;
      lastEventAt = Date.now();
      if (evt.event === 'node_started') {
        nodeStart[evt.data.node_id] = stamp();
        console.log(`[probe ${stamp()}] ▶ 节点开始: ${evt.data.title || evt.data.node_type} (gap ${gap / 1000 | 0}s)`);
      } else if (evt.event === 'node_finished') {
        console.log(`[probe ${stamp()}] ✔ 节点结束: ${evt.data.title || evt.data.node_type} status=${evt.data.status} (gap ${gap / 1000 | 0}s)`);
      } else if (evt.event === 'workflow_finished') {
        console.log(`[probe ${stamp()}] ★ 工作流完成 status=${evt.data && evt.data.status}`);
      } else if (evt.event === 'ping') {
        // 心跳，不刷屏
      } else if (evt.event === 'error' || evt.event === 'workflow_failed') {
        console.log(`[probe ${stamp()}] ✘ 异常事件 ${evt.event}: ${evt.message || ''}`);
      }
      if (Date.now() - lastEventAt > 0) lastEventAt = Date.now();
    }
  }
  console.log(`[probe ${stamp()}] 流结束。最长事件间隔 = ${(maxGapMs / 1000).toFixed(1)}s（空闲超时阈值 ${IDLE_MS / 1000}s）`);
  console.log(maxGapMs < IDLE_MS ? '结论：✔ 心跳/事件间隔始终低于空闲超时，修复有效' : '结论：✘ 存在超过空闲超时的间隔，需要调大 DIFY_IDLE_TIMEOUT_MS');
})().catch((e) => {
  console.log(`[probe ${stamp()}] 探测失败: ${e.name} ${e.message}`);
});
