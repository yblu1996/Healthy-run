// Dify 工作流对接：与 lib/coze.js 完全同签名（runWorkflow({images, userText, goal, raceDate, history})），
// api/index.js 通过 AI_PROVIDER 环境变量切换，扣子链路保持原样可随时切回。
//
// 相比扣子侧的简化：扣子不支持图片数组，被迫拆成 image1~imageN 逐张传；
// Dify 开始节点用 file-list 类型变量原生支持整组图片，images 一次传入即可，
// 识图节点直接引用列表，没有张数拆分的变通逻辑。

const { parseModelJson } = require('./model-json');

const BASE_URL = (process.env.DIFY_BASE_URL || 'https://api.dify.ai').replace(/\/+$/, '');
// 实测（SSE 探测，high 档 10 图）：识图节点 ~18s，诊断计划节点 ~153s，合计 ~3 分钟。
// 但服务端排队/预热会让同一档跑出 2-4 倍差异（最慢见过 ~9 分钟），所以按"最坏情况"设线。
// 因此不能用"总超时"：470 秒会把能跑完的请求在最后阶段砍掉，用户看到"分析失败"但额度/算力其实已消耗。
// 改为"空闲超时 + 硬上限"：流里每收到一个事件就续期，只有真卡死才判超时；15 分钟绝对兜底。
const IDLE_TIMEOUT_MS = Number(process.env.DIFY_IDLE_TIMEOUT_MS) || 180 * 1000; // 3 分钟无任何数据 → 判卡死
const HARD_TIMEOUT_MS = Number(process.env.DIFY_HARD_TIMEOUT_MS) || 900 * 1000; // 15 分钟绝对上限，防止无限等待

async function runWorkflow({ images, userText, goal, raceDate, history }) {
  if (!process.env.DIFY_API_KEY) {
    throw new Error('未配置 DIFY_API_KEY（Dify 应用的 API 密钥）');
  }

  const controller = new AbortController();
  let idleTimer = null;
  const hardTimer = setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);
  // 每收到一个 SSE 事件就续期空闲计时器：慢但仍在产出的工作流不会被误杀
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };
  touch();
  let gotResponse = false;

  try {
    const res = await fetch(`${BASE_URL}/v1/workflows/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {
          // 开始节点变量与此处一一对应：
          // user_text / goal / race_date / history 为 String，images 为 file-list（整组图片）
          user_text: userText || '',
          goal: goal || 'none',
          race_date: raceDate || '',
          history: history || '',
          images: (Array.isArray(images) ? images.filter(Boolean) : []).map((url) => ({
            type: 'image',
            transfer_method: 'remote_url',
            url,
          })),
        },
        response_mode: 'streaming', // blocking 模式有平台超时上限，SSE 才能稳跑完长耗时工作流
        user: 'run-diagnostic-platform',
      }),
      signal: controller.signal,
    });
    gotResponse = true;

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch {}
      throw new Error(`Dify 接口错误 ${res.status}：${detail || res.statusText}`);
    }

    // 聚合 SSE：只关心 workflow_finished（成功）与 error / workflow_failed（失败）
    const output = await readSseOutputs(res.body, touch);
    // 结束节点输出的 recognition / diagnosis_result 可能仍是 JSON 字符串，统一解包（与扣子侧同逻辑）；
    // 模型夹 <think> 思考块、```json 围栏，或写出结构性瑕疵（如根对象提前闭合）都由 parseModelJson 兜住。
    // 修补不了就保持原样返回，交给接口层判失败（不扣次数），绝不能把半成品当报告入库
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      for (const key of ['recognition', 'diagnosis_result']) {
        if (typeof output[key] === 'string') {
          const parsed = parseModelJson(output[key]);
          if (parsed) output[key] = parsed;
        }
      }
    }
    return output;
  } catch (e) {
    // abort 经常发生在读流期间（本场景正是如此），必须在这里统一转成可读文案，
    // 否则原始 AbortError 会直接冒泡到接口层，用户只看到"操作被中止"
    if (e.name === 'AbortError') {
      throw new Error('AI 分析超时（超过 15 分钟，或 3 分钟无响应数据）。该次诊断可能仍在服务器端执行，请稍后到历史记录查看结果，或减少图片数量后重试');
    }
    // 还没拿到响应头就失败 → 网络层错误，包装成可读文案
    if (!gotResponse) throw new Error('连接 Dify 失败：' + e.message);
    throw e;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(hardTimer);
  }
}

async function readSseOutputs(body, onActivity) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // 收到任何 chunk 就续期空闲超时（注释行/心跳包也算"流活着"）
    if (onActivity) onActivity();
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // 末行可能不完整，留到下一轮

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }

      if (evt.event === 'workflow_finished') {
        if (evt.data && evt.data.status === 'failed') {
          throw new Error('Dify 工作流执行失败：' + (evt.data.error || '未知错误'));
        }
        return (evt.data && evt.data.outputs) || {};
      }
      if (evt.event === 'error' || evt.event === 'workflow_failed') {
        throw new Error('Dify 工作流异常：' + (evt.message || (evt.data && evt.data.error) || '未知错误'));
      }
    }
  }
  // 流结束仍无 workflow_finished（平台侧异常断流）
  throw new Error('Dify 响应流提前结束，未收到工作流结果');
}

module.exports = { runWorkflow };
