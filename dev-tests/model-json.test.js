// 用真实坏数据（一缕春风 v15）验证 model-json 的修补能力 + 回归正常输出
const fs = require('fs');
const path = require('path');
const { parseModelJson } = require('../lib/model-json');

let fail = 0;
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) fail++;
};

// 1) 真实坏数据：根对象提前闭合 + 带 <think> 思考块
const bad = fs.readFileSync(path.join(__dirname, 'bad-diagnosis-v15.txt'), 'utf8');
const r1 = parseModelJson(bad);
check('坏数据 v15 可修复', !!r1);
if (r1) {
  check('  → 有 summary', typeof r1.summary === 'string' && r1.summary.length > 10);
  check('  → plan_8_weeks 8 周', Array.isArray(r1.plan_8_weeks) && r1.plan_8_weeks.length === 8, String(r1.plan_8_weeks && r1.plan_8_weeks.length));
  check('  → diagnosis 数组', Array.isArray(r1.diagnosis) && r1.diagnosis.length > 0, String(r1.diagnosis && r1.diagnosis.length));
  check('  → next_check 已保留', typeof r1.next_check === 'string' && r1.next_check.length > 10);
  check('  → 未被思考块污染', !JSON.stringify(r1).includes('<think>'));
}

// 2) 正常输出不受影响
const ok = '{"risk_alert":null,"summary":"正常","diagnosis":[{"issue":"a","risk":"低"}],"plan_8_weeks":[{"week":1}]}';
const r2 = parseModelJson(ok);
check('正常 JSON 原样解析', r2 && r2.summary === '正常');

// 3) 带 ```json 围栏
const fenced = '```json\n{"summary":"围栏","plan_8_weeks":[]}\n```';
check('围栏包裹可解析', (parseModelJson(fenced) || {}).summary === '围栏');

// 4) 尾逗号
check('尾逗号可解析', (parseModelJson('{"summary":"尾逗号","diagnosis":[],}') || {}).summary === '尾逗号');

// 5) 前后有解释文字
check('前后夹杂文字可解析', (parseModelJson('好的，这是报告：\n{"summary":"夹杂"}\n希望有帮助') || {}).summary === '夹杂');

// 6) 字符串内容里的 } 与逗号不能被误伤
const tricky = '{"summary":"心率{150}，配速 6\'28\\"/km, 尾注","diagnosis":[{"issue":"含 } 和 ] 的 issue","risk":"低"}]}';
const r6 = parseModelJson(tricky);
check('字符串内含 } ] , 不被误伤', r6 && r6.summary.includes('尾注') && r6.diagnosis[0].issue.includes(']'));

// 7) 嵌套对象的合法 }, "key" 不能被误删
const nested = '{"progress":{"improved":["a"],"regressed":[]},"summary":"嵌套","plan_8_weeks":[{"week":1}]}';
const r7 = parseModelJson(nested);
check('合法嵌套不被误删', r7 && r7.progress && r7.progress.improved.length === 1 && r7.summary === '嵌套');

// 8) 彻底坏掉（截断到一半）→ 返回 null，不能假装成功
const truncated = '{"summary":"截断的报告","diagnosis":[{"issue":"没写完';
check('真截断返回 null', parseModelJson(truncated) === null);

// 9) 非字符串入参
check('已是对象原样返回', parseModelJson({ summary: 'x' }).summary === 'x');
check('null 返回 null', parseModelJson(null) === null);

// 10) 真实坏数据：字符串值里出现未转义的英文双引号（low 档实测踩到）
const badQuote = fs.readFileSync(path.join(__dirname, 'bad-diagnosis-low-quotes.txt'), 'utf8');
const r10 = parseModelJson(badQuote);
check('裸引号坏数据可修复', !!r10);
if (r10) {
  check('  → 诊断项一条不少（原文 3 条）', Array.isArray(r10.diagnosis) && r10.diagnosis.length === 3, String(r10.diagnosis && r10.diagnosis.length));
  check('  → 8 周计划', Array.isArray(r10.plan_8_weeks) && r10.plan_8_weeks.length === 8, String(r10.plan_8_weeks && r10.plan_8_weeks.length));
  check('  → 引号内容保留完整', String(r10.diagnosis[0].evidence).includes('前两个月出差中断'));
  check('  → 末尾字段未丢', typeof r10.race_day_strategy === 'string' && r10.race_day_strategy.length > 10);
  check('  → risk_alert 为 null 未被改成字符串', r10.risk_alert === null);
}

// 11) 裸引号修复不能误伤本身合法的 JSON
const legal = '{"risk_alert":null,"summary":"他说\\"没问题\\"，配速 5\'49\\"/km","diagnosis":[{"issue":"a","risk":"低","advice":"照做"}]}';
const r11 = parseModelJson(legal);
check('合法（已转义）引号不受影响', r11 && r11.diagnosis.length === 1 && r11.summary.includes('没问题'));
check('合法 JSON 保持原样', JSON.stringify(r11) === JSON.stringify(JSON.parse(legal)));

// 12) 键名后的冒号不能被当成"内容引号"
const keys = '{"summary":"甲","plan_8_weeks":[{"week":1,"focus":"乙"}]}';
const r12 = parseModelJson(keys);
check('键名/嵌套键正常', r12 && r12.plan_8_weeks[0].focus === '乙');

console.log(fail ? `\n${fail} 项未通过` : '\n全部通过');
process.exit(fail ? 1 : 0);
