// 思考强度 A/B 矩阵实测：对同一份固定输入（dev-tests/.ab-input.json）依次跑 low / high / max，
// 记录每个节点的耗时与原始输出，落盘 .ab-<档位>.json，跑完自动恢复线上档位（默认 high）。
// 用法：node dev-tests/dify-ab-matrix.js [low high max]   默认三档全跑
//       node dev-tests/dify-ab-matrix.js low --input .ab-input-sparse.json --tag sparse
//       线上档位变过之后，用 PROD_EFFORT=low node dev-tests/dify-ab-matrix.js ... 指定恢复目标
//         （--input 换输入夹具，--tag 给落盘文件加后缀，避免覆盖主流程的结果）
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const KEY = fs.readFileSync(path.join(__dirname, '.dify-appkey.txt'), 'utf8').trim();
const BASE = (process.env.DIFY_BASE_URL || 'http://localhost:8180').replace(/\/+$/, '');

const SB_BUCKET = process.env.STORAGE_BUCKET || 'run-images';
const SB_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');

// 夹具里存的是历史上传时的图片地址，而桶已转私有——那些公开 URL 现在一律返回 400。
// 不重新签名的话，识图会静默拿到空图、A/B 两组都输出 unclear，结论全是错的却看不出异常。
// 所以每次跑之前，按对象路径现签一遍。
async function freshImageUrls(list) {
  const sb = createClient(SB_BASE, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const paths = list.map((u) => {
    for (const pre of [`${SB_BASE}/storage/v1/object/sign/${SB_BUCKET}/`, `${SB_BASE}/storage/v1/object/public/${SB_BUCKET}/`]) {
      if (typeof u === 'string' && u.startsWith(pre)) return u.slice(pre.length).split('?')[0].split('#')[0];
    }
    return /^[\w-]+\/[\w.-]+$/.test(u || '') ? u : null;
  });
  const bad = list.filter((_, i) => !paths[i]);
  if (bad.length) throw new Error('夹具里这些地址解析不出对象路径：' + JSON.stringify(bad));
  const { data, error } = await sb.storage.from(SB_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new Error('图片重新签名失败：' + error.message);
  return data.map((d) => d.signedUrl);
}

const argv = process.argv.slice(2);
const INPUT_FILE = (() => { const i = argv.indexOf('--input'); return i >= 0 ? argv[i + 1] : '.ab-input.json'; })();
const TAG = (() => { const i = argv.indexOf('--tag'); return i >= 0 ? '-' + argv[i + 1] : ''; })();
const args = argv.filter((a) => ['low', 'high', 'max'].includes(a));
const list = args.length ? args : ['low', 'high', 'max'];
// 线上当前档位：测试跑完要恢复到这个值，别写死在逻辑里（改档见《Dify工作流搭建手册》第十一节第 6 小节）
const PROD_EFFORT = process.env.PROD_EFFORT || 'high';

function setEffort(effort) {
  execFileSync(process.execPath, [path.join(__dirname, 'dify-apply-reasoning.js'), effort], { stdio: 'inherit' });
}

async function runOnce(effort) {
  const input = JSON.parse(fs.readFileSync(path.join(__dirname, INPUT_FILE), 'utf8'));
  const images = await freshImageUrls(input.images.filter(Boolean));
  const t0 = Date.now();
  const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
  console.log(`----- [${effort}] ${stamp()} 发起 streaming，图 ${input.images.length} 张，goal=${input.goal}`);

  const res = await fetch(`${BASE}/v1/workflows/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputs: {
        user_text: input.user_text,
        goal: input.goal,
        race_date: input.race_date,
        history: '[]',
        images: images.map((u) => ({ type: 'image', transfer_method: 'remote_url', url: u })),
      },
      response_mode: 'streaming',
      user: 'ab-' + effort,
    }),
  });
  if (!res.ok) { console.log('HTTP', res.status, (await res.text()).slice(0, 300)); return null; }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const timings = [];
  let outputs = null;
  let total = null;

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
        console.log(`[${stamp()}] ▶ ${d.title}`);
      } else if (e.event === 'node_finished') {
        const us = d.execution_metadata && d.execution_metadata.usage;
        const outLen = d.outputs ? JSON.stringify(d.outputs).length : 0;
        console.log(`[${stamp()}] ■ ${d.title} elapsed=${d.elapsed_time ? Number(d.elapsed_time).toFixed(1) + 's' : '?'} 输出${outLen}B${us ? ' usage=' + JSON.stringify(us) : ''}`);
        timings.push({ node: d.title, elapsed: d.elapsed_time ? Number(d.elapsed_time) : null, outLen });
      } else if (e.event === 'workflow_finished') {
        total = d.elapsed_time ? Number(d.elapsed_time) : null;
        outputs = d.outputs || {};
        console.log(`[${stamp()}] ⛳ 结束 status=${d.status} 总耗时=${total}s`);
      } else if (e.event === 'error') {
        console.log('✖ error:', e.message, e.code || '');
      }
    }
  }

  fs.writeFileSync(path.join(__dirname, `.ab-${effort}${TAG}.json`), JSON.stringify({ effort, timings, total, outputs }, null, 2));
  console.log(`[落盘] .ab-${effort}${TAG}.json（总耗时 ${total}s）`);
  return { timings, total };
}

(async () => {
  for (const eff of list) {
    console.log(`\n========== 档位 ${eff} ==========`);
    try {
      setEffort(eff);
      await runOnce(eff);
    } catch (e) {
      console.log(`[${eff}] 失败：`, e.message);
    }
  }
  // 收尾恢复当前线上配置 + 汇总。
  // 判据是"最后一档是不是线上档位"而不是"列表里有没有它"：否则跑 `low high` 会停在 high，
  // 线上配置被留在测试档位，下一位真实用户就会踩到。
  // ⚠️ 线上档位会变（2026-09-23 起两个节点都是 high），所以别把值写死在恢复逻辑里。
  if (list.length && list[list.length - 1] !== PROD_EFFORT) {
    console.log(`\n恢复线上配置为 ${PROD_EFFORT} ...`);
    try { setEffort(PROD_EFFORT); } catch (e) { console.log('恢复失败：', e.message); }
  }

  console.log('\n========== 汇总 ==========');
  for (const eff of ['low', 'high', 'max']) {
    const f = path.join(__dirname, `.ab-${eff}.json`);
    if (!fs.existsSync(f)) { console.log(`${eff.padEnd(5)} 未测`); continue; }
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const per = j.timings.map((t) => `${t.node}=${t.elapsed}s/${t.outLen}B`).join('  ');
    console.log(`${eff.padEnd(5)} 总计 ${String(j.total).padStart(6)}s | ${per}`);
  }
})();
