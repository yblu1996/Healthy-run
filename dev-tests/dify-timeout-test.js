// 复现并验证"诊断计划节点慢（~480s）被旧的总超时（470s）误杀"这个 bug 的修复。
// 旧逻辑：固定 470 秒总超时 → 480 秒的请求在第 470 秒被 abort，用户看到"分析失败"但算力已消耗。
// 新逻辑：空闲超时（每个 SSE 事件续期）+ 硬上限。慢但持续产出的流必须能跑完。
require('dotenv').config();
process.env.DIFY_API_KEY = process.env.DIFY_API_KEY || 'test-key';
// 把超时压到秒级，测试才跑得快；生产默认值不变
process.env.DIFY_IDLE_TIMEOUT_MS = '600';
process.env.DIFY_HARD_TIMEOUT_MS = '3000';

const { runWorkflow } = require('../lib/dify.js');

let checks = 0;
let failed = 0;
function check(name, cond, extra) {
  checks++;
  if (!cond) { failed++; console.log('  X ' + name + (extra ? ' -- ' + extra : '')); }
  else console.log('  OK ' + name);
}

const FINISHED = JSON.stringify({
  event: 'workflow_finished',
  data: { status: 'succeeded', outputs: { recognition: '{"a":1}', diagnosis_result: '{"b":2}' } },
});

// 真实 SSE 每行带 \n；真实 ReadableStream 在 fetch abort 后，挂着的 read() promise 会 reject
function makeBody(chunks, gapMs, signal) {
  let abortErr = null;
  const armAbort = () => {
    abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
  };
  if (signal) {
    if (signal.aborted) armAbort();
    else signal.addEventListener('abort', armAbort);
  }
  return {
    getReader() {
      let i = 0;
      return {
        async read() {
          if (abortErr) throw abortErr;
          if (i < chunks.length) {
            const idx = i++;
            await new Promise((r) => setTimeout(r, gapMs));
            return { value: new TextEncoder().encode(chunks[idx]), done: false };
          }
          // 产出完毕后挂住：真实流在 abort 前这个 read 不会返回，只能靠 abort 打断
          await new Promise((resolve, reject) => {
            if (abortErr) return reject(abortErr);
            signal.addEventListener('abort', () => { armAbort(); reject(abortErr); });
          });
          throw abortErr;
        },
      };
    },
  };
}

(async () => {
  console.log('--- 场景 1：慢但持续产出的流必须成功（验证续期机制真的在起作用） ---');
  // 事件间隔 200ms < 空闲超时 600ms：续期成立 → 计时器永不到期 → 必须跑完。
  // 若 touch 没被调用，600ms 就会 abort，这个场景必然失败。
  const events = [];
  for (let i = 0; i < 12; i++) events.push('data: ' + JSON.stringify({ event: 'text_chunk', data: { text: 'x' } }) + '\n');
  events.push('data: ' + FINISHED + '\n');
  const savedFetch = global.fetch;
  let fetchCalled = 0;
  let usedSignal = null;
  global.fetch = async (_url, opts) => {
    fetchCalled++;
    usedSignal = opts.signal;
    return { ok: true, status: 200, body: makeBody(events, 200, opts.signal) };
  };
  try {
    const out = await runWorkflow({ images: ['http://x/1.jpg'], userText: '', goal: 'none', raceDate: '', history: '' });
    check('慢流跑完并返回 outputs', !!out && out.recognition && out.recognition.a === 1, JSON.stringify(out));
    check('JSON 字符串被自动解包', out && out.diagnosis_result && out.diagnosis_result.b === 2);
    check('fetch 只调用一次（无重试风暴）', fetchCalled === 1, 'fetchCalled=' + fetchCalled);
    check('abort 信号确实传给了 fetch', !!usedSignal);
  } catch (e) {
    check('慢流不应报错', false, e.message);
  }

  console.log('--- 场景 2：流中途卡死（超过空闲超时）必须抛可读错误 ---');
  // 3 个事件后流停住 → 600ms 空闲超时触发 abort → 挂着的 read 抛 AbortError → 转成可读文案
  const active = [];
  for (let i = 0; i < 3; i++) active.push('data: ' + JSON.stringify({ event: 'text_chunk', data: { text: 'x' } }) + '\n');
  global.fetch = async (_url, opts) => ({ ok: true, status: 200, body: makeBody(active, 200, opts.signal) });
  const t0 = Date.now();
  try {
    await runWorkflow({ images: [], userText: '', goal: 'none', raceDate: '', history: '' });
    check('卡死的流必须报错', false, '竟然成功了');
  } catch (e) {
    const dt = Date.now() - t0;
    check('卡死抛出的是可读文案（非 AbortError 原文）', /AI 分析超时/.test(e.message), e.message);
    check('在空闲超时附近触发（约 600ms，不是干等 120s）', dt < 5000, '耗时 ' + dt + 'ms');
  }

  console.log('--- 场景 3：Dify 返回业务错误要透传 ---');
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: '模型额度不足' }) });
  try {
    await runWorkflow({ images: [], userText: '', goal: 'none', raceDate: '', history: '' });
    check('HTTP 500 必须抛错', false);
  } catch (e) {
    check('业务错误文案透传', /模型额度不足/.test(e.message), e.message);
  }

  console.log('--- 场景 4：连接层失败要包装成可读文案 ---');
  global.fetch = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  try {
    await runWorkflow({ images: [], userText: '', goal: 'none', raceDate: '', history: '' });
    check('网络错误必须抛错', false);
  } catch (e) {
    check('网络错误被包装', /连接 Dify 失败/.test(e.message), e.message);
  }

  global.fetch = savedFetch;
  console.log('\n结果：' + (checks - failed) + '/' + checks + ' 通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('TEST-CRASH:', e); process.exit(2); });
