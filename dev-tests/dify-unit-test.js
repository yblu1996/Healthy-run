// dify.js 单元验证：mock fetch 返回假 SSE 流，验证 runWorkflow 的解析/解包/错误路径
process.env.DIFY_API_KEY = 'app-test-key';

const sse = (events) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

const results = [];
const check = (n, p, d) => results.push(`${p ? 'PASS' : 'FAIL'}  ${n}${p ? '' : '  << ' + d}`);

async function runWithFetch(mock) {
  const original = global.fetch;
  global.fetch = mock;
  try {
    delete require.cache[require.resolve('../lib/dify')];
    const { runWorkflow } = require('../lib/dify');
    return await runWorkflow({
      images: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
      userText: '测试', goal: 'none', raceDate: '', history: '[]',
    });
  } finally {
    global.fetch = original;
  }
}

(async () => {
  // 1. 正常流：workflow_finished.outputs，recognition 是 JSON 字符串应被解包
  let reqBody;
  let out = await runWithFetch(async (url, opts) => {
    reqBody = JSON.parse(opts.body);
    return sse([
      { event: 'workflow_started', data: {} },
      { event: 'node_finished', data: { title: '识图' } },
      {
        event: 'workflow_finished',
        data: {
          status: 'succeeded',
          outputs: {
            recognition: '{"image_type":"app_screenshot","metrics":{"avg_heart_rate":145}}', // 字符串形式
            diagnosis_result: { summary: '总评', plan_8_weeks: [{ week: 1 }] }, // 对象形式
          },
        },
      },
    ]);
  });
  check('outputs 解析 + recognition 字符串解包', out.recognition.metrics.avg_heart_rate === 145, JSON.stringify(out));
  check('diagnosis_result 对象直传', out.diagnosis_result.summary === '总评', JSON.stringify(out));
  check('请求体：file-list remote_url 整组传图', Array.isArray(reqBody.inputs.images) && reqBody.inputs.images.length === 2 && reqBody.inputs.images[0].transfer_method === 'remote_url', JSON.stringify(reqBody.inputs.images));
  check('请求体：streaming 模式', reqBody.response_mode === 'streaming', reqBody.response_mode);
  check('请求体：5 个输入变量齐全', ['user_text', 'goal', 'race_date', 'history', 'images'].every(k => k in reqBody.inputs), JSON.stringify(Object.keys(reqBody.inputs)));

  // 2. 工作流失败事件
  let err1 = null;
  try { await runWithFetch(() => sse([{ event: 'workflow_finished', data: { status: 'failed', error: '节点2崩了' } }])); }
  catch (e) { err1 = e.message; }
  check('failed 状态抛错', /节点2崩了/.test(err1 || ''), err1);

  // 3. error 事件
  let err2 = null;
  try { await runWithFetch(() => sse([{ event: 'error', message: 'InvalidToken' }])); }
  catch (e) { err2 = e.message; }
  check('error 事件抛错', /InvalidToken/.test(err2 || ''), err2);

  // 4. HTTP 非 200
  let err3 = null;
  try {
    await runWithFetch(async () => new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }));
  } catch (e) { err3 = e.message; }
  check('HTTP 401 带平台错误信息', /401.*Unauthorized/.test(err3 || ''), err3);

  // 5. 流提前结束
  let err4 = null;
  try { await runWithFetch(() => sse([{ event: 'node_finished', data: {} }])); }
  catch (e) { err4 = e.message; }
  check('断流抛明确错误', /提前结束/.test(err4 || ''), err4);

  console.log(results.join('\n'));
  console.log(`\n${results.filter(l => l.startsWith('PASS')).length}/${results.length} passed`);
  process.exit(results.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
