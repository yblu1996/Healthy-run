const { parseModelJson } = require('./model-json');

const BASE_URL = (process.env.COZE_BASE_URL || 'https://api.coze.com').replace(/\/+$/, '');

// 请求总超时：扣子正常 30-60 秒，给到 4.5 分钟；必须小于后端 5 分钟的僵尸记录清理线，
// 且大于前端 200 秒的等待——前端超时后用户去历史记录看，服务端还能把报告补落库
const WORKFLOW_TIMEOUT_MS = 270 * 1000;

// 扣子视觉模型不支持把字符串 URL 当图片读，也不能把数组整体标成 Image：
// 开始节点必须拆成 image1..imageN（String），大模型节点引用时逐个把类型改成 Image。
// 这里按实际张数拆分，不足 10 张不补空位，避免空值触发"未提供图片"。
function buildImageParams(images) {
  const list = Array.isArray(images) ? images.filter(Boolean).slice(0, 10) : [];
  const params = {};
  list.forEach((url, i) => { params[`image${i + 1}`] = url; });
  return params;
}

async function runWorkflow({ images, userText, goal, raceDate, history }) {
  // 缺配置时给出能定位问题的错误，而不是发 Bearer undefined 让用户看到上游 401
  if (!process.env.COZE_PAT || !process.env.COZE_WORKFLOW_ID) {
    throw new Error('Coze 未配置：请在 .env 填写 COZE_PAT 与 COZE_WORKFLOW_ID');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKFLOW_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${BASE_URL}/v1/workflow/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.COZE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow_id: process.env.COZE_WORKFLOW_ID,
        parameters: {
          // images（数组）保留给旧配置兼容；扣子改用方案 1 后认 image1..imageN
          images,
          ...buildImageParams(images),
          user_text: userText || '',
          goal: goal || 'none',
          race_date: raceDate || '',
          history: history || '',
        },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('扣子工作流执行超时（超过 4.5 分钟未返回）');
    }
    throw new Error('连接扣子失败：' + e.message);
  } finally {
    clearTimeout(timer);
  }

  const data = await res.json();

  if (data.code !== 0) {
    throw new Error(data.msg || '扣子工作流执行失败');
  }

  // 扣子的 data 字段通常是 JSON 字符串，统一解析成对象
  const output = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;

  // 扣子结束节点输出的 recognition / diagnosis_result 可能仍是 JSON 字符串
  // （结束节点变量类型选了 String 时会再包一层），统一解包，否则前端渲染会报"报告数据异常"；
  // 模型夹 <think> 思考块 / ```json 围栏 / 结构性瑕疵都由 parseModelJson 兜住，
  // 修补不了则保持原样，交给接口层判失败（不扣次数），不把半成品当报告入库
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    for (const key of ['recognition', 'diagnosis_result']) {
      if (typeof output[key] === 'string') {
        const parsed = parseModelJson(output[key]);
        if (parsed) output[key] = parsed;
      }
    }
  }

  return output;
}

module.exports = { runWorkflow };
