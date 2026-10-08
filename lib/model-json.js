// 模型输出 JSON 的容错解析（Dify / 扣子 两个通道共用）
//
// 为什么需要：LLM 除了会在 JSON 前后夹 <think> 思考块、```json 代码围栏之外，
// 偶尔还会写出结构性瑕疵。本平台实测到过最典型的一种是"根对象提前闭合"——
// 模型写完 race_day_strategy 后多吐了一个 }，紧接着又继续写 , "next_check": ...，
// 整串就变成 { ... } , "next_check": ... }，JSON.parse 必然失败。
// 结果是：报告在数据库里是 status=done，用户点开却看到"报告数据异常"。
//
// 策略：从宽到严依次尝试修补，全部失败返回 null，由调用方判为失败（不扣次数），
// 绝不把半成品当成功结果入库。修补只做结构层面的清理，不改动字符串内容
// （唯一的例外是最后一招"裸引号转义"，见 escapeInnerQuotes，只有前面全失败时才启用）。

function stripThink(text) {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, ''); // 只有开头没有闭合时（被截断）也剥掉
}

function stripFences(text) {
  return String(text)
    .replace(/^\s*```(?:json|JSON)?\s*/i, '')
    .replace(/\s*```\s*$/, '');
}

// 字符串感知的扫描：跳过多字节内容与 \ 转义，避免把正文里的引号当结构处理
function eachStructuralChar(s, fn) {
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (fn(c, i) === false) return;
  }
}

// 找出"根对象提前闭合"的多余 } / ]：depth 归零后，后面第一个非空白字符是逗号。
// 合法的嵌套闭合永远不会让 depth 归零，所以这里不会误伤。
function findPrematureClose(s) {
  let depth = 0;
  let bad = -1;
  eachStructuralChar(s, (c, i) => {
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === ',') { bad = i; return false; }
      }
      if (depth < 0) { bad = i; return false; }
    }
  });
  return bad;
}

function dropPrematureClose(s) {
  let out = s;
  // 最多处理 5 处，防御异常输出里有连续多个多余闭合
  for (let k = 0; k < 5; k++) {
    const i = findPrematureClose(out);
    if (i < 0) break;
    out = out.slice(0, i) + out.slice(i + 1);
  }
  return out;
}

// 去掉逗号后紧跟 } 或 ] 的多余逗号（尾逗号），同样跳过字符串内部
function dropTrailingCommas(s) {
  const drop = new Set();
  eachStructuralChar(s, (c, i) => {
    if (c !== ',') return;
    let j = i + 1;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] === '}' || s[j] === ']') drop.add(i);
  });
  if (!drop.size) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) if (!drop.has(i)) out += s[i];
  return out;
}

// 字符串值内部出现未转义的英文双引号。
// 高发场景：模型照抄用户原话或配速（"用户自述"前两个月出差中断""、5'49"），
// 中间的 " 没有转义，整串 JSON 直接坏掉 —— 实测 low 档一次就踩到，报告无法渲染。
// 判据：字符串内的 " 只有在**后面紧跟 , } ] : 之一**（允许中间夹空白）时才是真正的结束引号，
// 否则它是内容里的裸引号，转义成 \"。值中间出现 " 后面跟 : 的情况在合法 JSON 里不存在，
// 所以这个判据不会把合法的结束引号误判成内容。
function escapeInnerQuotes(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (c === '\\') { out += c; esc = true; continue; }
    if (c !== '"') { out += c; continue; }
    if (!inStr) { inStr = true; out += c; continue; }
    let j = i + 1;
    while (j < s.length && /\s/.test(s[j])) j++;
    const nxt = s[j];
    if (nxt === ',' || nxt === '}' || nxt === ']' || nxt === ':') { inStr = false; out += c; }
    else out += '\\"';
  }
  return out;
}

function tryParseObject(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/**
 * 解析模型输出的 JSON 字符串。已是对象/数组则原样返回，解析不出来返回 null。
 */
function parseModelJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;

  const text = stripFences(stripThink(raw)).trim();
  if (!text) return null;

  let v = tryParseObject(text);
  if (v) return v;

  // 前后还有解释性文字时，截取最外层 {...}
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let core = text.slice(a, b + 1);

  // 修补顺序：先做不动内容的清理，再上"裸引号转义"这种会改字符串的重手段，
  // 保证能靠结构清理救回来的输出不会被引号规则动过。
  const attempts = [
    core,
    dropTrailingCommas(core),
    dropPrematureClose(core),
    dropTrailingCommas(dropPrematureClose(core)),
    dropPrematureClose(dropTrailingCommas(core)),
  ];
  for (const t of attempts) {
    v = tryParseObject(t);
    if (v) return v;
  }

  const quoted = attempts.map(escapeInnerQuotes);
  for (const t of quoted) {
    v = tryParseObject(t);
    if (v) return v;
  }
  return null;
}

module.exports = { parseModelJson, stripThink, stripFences };
