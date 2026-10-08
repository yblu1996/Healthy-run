// 对真实"跑步诊断"工作流做变体测试：隔离诊断节点挂起的触发因素
// 用法: node dify-variant-test.js <variant>
// v1 = 诊断节点用户提示词去掉 {{#vision_1.text#}} 引用
// v2 = 系统提示词换成一句话（保留引用）
// v3 = 完整原始配置（对照）
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8180';
const APP = 'c19e631c-18e0-428d-bb26-d89fcd71c862';

async function h() {
  return {
    Cookie: fs.readFileSync(path.join(__dirname, '.dify-cookie.txt'), 'utf8').trim(),
    'X-CSRF-Token': fs.readFileSync(path.join(__dirname, '.dify-csrf.txt'), 'utf8').trim(),
    'Content-Type': 'application/json',
  };
}

async function liveRun(key, images) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(BASE + '/v1/workflows/run', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { user_text: '45岁女性，周跑量25公里，配速630，心率148', goal: 'none', race_date: '', history: '[]', images }, response_mode: 'streaming', user: 'paowu-test' }),
      signal: ctrl.signal,
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', out = null, nodes = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const l of lines) {
        const t = l.trim();
        if (!t.startsWith('data:')) continue;
        try {
          const e = JSON.parse(t.slice(5).trim());
          if (e.event === 'node_finished') nodes.push((e.data.title || '') + ':' + e.data.status + ':' + (e.data.elapsed_time || 0).toFixed(1) + 's');
          if (e.event === 'workflow_finished') out = e.data;
          if (e.event === 'error') console.log('ERROR EVENT:', (e.message || '').slice(0, 150));
        } catch {}
      }
    }
    return { nodes: nodes.join(' | '), status: out && out.status, outputs: out && out.outputs, secs: ((Date.now() - t0) / 1000).toFixed(0) };
  } catch (e) {
    return { hang: true, secs: ((Date.now() - t0) / 1000).toFixed(0) };
  } finally {
    clearTimeout(tm);
  }
}

(async () => {
  const variant = process.argv[2] || 'v1';
  const headers = await h();
  const r1 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, { headers });
  const draft = await r1.json();
  const diag = draft.graph.nodes.find((n) => n.data.type === 'llm' && n.data.title === '诊断计划');
  const origSys = diag.data.prompt_template.find((p) => p.role === 'system');
  const origUser = diag.data.prompt_template.find((p) => p.role === 'user');

  if (variant === 'v1') {
    origUser.text = '请直接输出一个仅含 summary 字段的JSON：{"summary":"测试通过"}。不要参考识图结果。';
    console.log('[v1] user prompt 替换为无引用小任务，system 保留原文');
  } else if (variant === 'v2') {
    origSys.text = '你是跑步教练。收到任何输入都输出：{"summary":"v2测试通过"}。只输出JSON。';
    console.log('[v2] system 换成一句话，user 保留原文（含识图引用）');
  } else {
    console.log('[v3] 保持原样（对照）');
  }

  const r2 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/draft`, {
    method: 'POST', headers,
    body: JSON.stringify({ graph: draft.graph, features: draft.features, environment_variables: draft.environment_variables || [], conversation_variables: draft.conversation_variables || [], hash: draft.hash }),
  });
  console.log('PUT draft:', r2.status);
  if (r2.status !== 200) process.exit(1);
  const r3 = await fetch(`${BASE}/console/api/apps/${APP}/workflows/publish`, { method: 'POST', headers, body: '{}' });
  console.log('publish:', r3.status);

  // 真实历史图片
  require('dotenv').config();
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: recs } = await supabase.from('run_records').select('images').eq('status', 'done').not('images', 'eq', '[]').order('created_at', { ascending: false }).limit(1);
  const images = recs && recs[0] ? recs[0].images : [];

  let kr = await (await fetch(`${BASE}/console/api/apps/${APP}/api-keys`, { headers })).json();
  const key = kr.data && kr.data[0] && kr.data[0].token;
  console.log('running live test...');
  const res = await liveRun(key, images);
  console.log('nodes:', res.nodes || '(no nodes)');
  console.log('status:', res.status || (res.hang ? 'HANG(120s无响应)' : '?'), '|', res.secs + 's');
  if (res.outputs) {
    const dia = typeof res.outputs.diagnosis_result === 'string' ? res.outputs.diagnosis_result : JSON.stringify(res.outputs.diagnosis_result);
    console.log('diagnosis_result 片段:', String(dia).slice(0, 200));
  }
})();
