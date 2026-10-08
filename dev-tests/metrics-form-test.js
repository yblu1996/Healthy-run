/*
 * 前端三项改动的逻辑自测（无需浏览器）：
 *   1) 核心数据本地记忆：saveMetrics / fillMetrics（含比赛日期三联下拉级联回填）
 *   2) 上传先行、比赛日期录错拦截和可选数据校验
 *   3) hero 文案：index.html 里"照片"已改"图片"且可拆两行
 *
 * 原理：用最小 DOM/localStorage 桩环境加载 public/app.js，再调用其中的真实函数。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = {};
const listeners = {}; // 元素事件回调：elId -> { type -> [fn] }

function makeEl(id) {
  const el = {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    _hidden: false,
    style: {},
    dataset: {},
    children: [],
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      toggle(c, force) { if (force === undefined) force = !this._set.has(c); force ? this._set.add(c) : this._set.delete(c); return force; },
      contains(c) { return this._set.has(c); },
    },
    get hidden() { return this._hidden; },
    set hidden(v) { this._hidden = v; },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; },
    focus() { this.focused = true; },
    addEventListener(type, fn) {
      listeners[this.id] = listeners[this.id] || {};
      listeners[this.id][type] = (listeners[this.id][type] || []);
      listeners[this.id][type].push(fn);
    },
    dispatchEvent(ev) {
      (listeners[this.id]?.[ev.type] || []).forEach((fn) => fn({ ...ev, target: this, currentTarget: this }));
    },
  };
  // 掉用 classList.toggle('hidden', ...) 时同步 _hidden，与真实元素一致
  const origToggle = el.classList.toggle.bind(el.classList);
  el.classList.toggle = (c, force) => {
    const r = origToggle(c, force);
    if (c === 'hidden') el._hidden = el.classList.contains('hidden');
    return r;
  };
  return el;
}

const els = {};
function getEl(id) { return els[id] || (els[id] = makeEl(id)); }

global.document = {
  getElementById: (id) => getEl(id),
  querySelector: (sel) => {
    const m = /^#([\w-]+)$/.exec(sel);
    if (m) return getEl(m[1]);
    return makeEl('q:' + sel); // 其余选择器给空壳，只读不写
  },
  querySelectorAll: () => [],
  addEventListener: () => {},
  title: '',
};
global.window = { addEventListener: () => {}, scrollTo: () => {}, open: () => null };
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.navigator = {};
global.Event = class { constructor(type) { this.type = type; } };
global.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
global.scrollTo = () => {};
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

// app.js 是浏览器脚本（无导出），在全局作用域执行，其顶层 const/函数对后续测试可见
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (extra ? '  <- ' + extra : '')); }
}
function todayYmd() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}
function offsetYmd(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

console.log('--- 3) hero 文案（静态文件断言） ---');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
check('hero 已把"跑姿照片"改为"跑姿图片"', !html.includes('上传跑步数据与跑姿照片') && html.includes('上传跑步数据与跑姿图片'));
check('hero 副标题按语义拆成两段（hero-line x2）', (html.match(/class="hero-line"/g) || []).length === 2);

console.log('--- 2) 比赛日期校验 raceDateProblem（缺项 / 过期 / 放行） ---');
const t = todayYmd();
const past = offsetYmd(-10);
const future = offsetYmd(5);
getEl('goal').value = 'half_marathon';
getEl('raceYear').value = String(past.y);
getEl('raceMonth').value = String(past.m);
getEl('raceDay').value = String(past.d);
check('半马 + 今天前 10 天 -> 过期', /晚于今天/.test(raceDateProblem()), raceDateProblem());
getEl('raceYear').value = String(t.y);
getEl('raceMonth').value = String(t.m);
getEl('raceDay').value = String(t.d);
check('比赛日期选今天 -> 拦截', /晚于今天/.test(raceDateProblem()), raceDateProblem());

// 用户反馈的 bug：只选年不选月/日、或选了月不选日，旧逻辑直接放行
getEl('raceMonth').value = '';
getEl('raceDay').value = '';
check('只选年不选月日 -> 拦截"不完整"', /完整的比赛日期/.test(raceDateProblem()), raceDateProblem());
getEl('raceMonth').value = String(future.m);
check('选了月不选日 -> 拦截"不完整"', /完整的比赛日期/.test(raceDateProblem()), raceDateProblem());
getEl('raceYear').value = String(future.y);
getEl('raceDay').value = String(future.d);
check('补齐日期且在未来 -> 放行', raceDateProblem() === '', raceDateProblem());

getEl('goal').value = 'none';
check('目标为健康跑 -> 不拦截', raceDateProblem() === '');
getEl('goal').value = 'full_marathon';
getEl('raceYear').value = '';
getEl('raceMonth').value = '';
getEl('raceDay').value = '';
check('全马但日期没选全 -> 拦截"不完整"', /完整的比赛日期/.test(raceDateProblem()), raceDateProblem());

console.log('--- 1) 核心数据本地记忆 saveMetrics / fillMetrics ---');
// 模拟用户上次填的数据
store['paowu_metrics'] = JSON.stringify({
  mGender: '男', mAge: '45', mHeight: '172', mWeight: '70',
  mRunYears: '1-3 年', mWeeklyVolume: '40', mPace: "6'30\"", mHr: '150',
  mCadence: '172', goal: 'half_marathon',
  raceYear: String(t.y + 1), raceMonth: '10', raceDay: '20',
});
fillMetrics();
check('性别回填', getEl('mGender').value === '男');
check('年龄回填', getEl('mAge').value === '45');
check('步频回填（选填项也要记）', getEl('mCadence').value === '172');
check('目标回填为半马', getEl('goal').value === 'half_marathon');
check('比赛日期区已展开（hidden 已移除）', getEl('raceDateWrap').classList.contains('hidden') === false, 'raceDateWrap hidden=' + getEl('raceDateWrap').classList.contains('hidden'));
check('比赛日期-年回填为明年', getEl('raceYear').value === String(t.y + 1), 'got ' + getEl('raceYear').value);
check('比赛日期-月回填', getEl('raceMonth').value === '10', 'got ' + getEl('raceMonth').value);
check('比赛日期-日回填', getEl('raceDay').value === '20', 'got ' + getEl('raceDay').value);

// 目标不是半马/全马时不应残留日期区展开
store['paowu_metrics'] = JSON.stringify({ mGender: '女', mAge: '30', goal: 'health' });
fillMetrics();
check('健康跑回填后日期区收起', getEl('raceDateWrap').classList.contains('hidden') === true);

// saveMetrics 写回
getEl('mHeight').value = '165';
getEl('mCadence').value = '178';
saveMetrics();
const saved = JSON.parse(store['paowu_metrics']);
check('saveMetrics 记住身高', saved.mHeight === '165');
check('saveMetrics 记住步频', saved.mCadence === '178');
check('saveMetrics 记住目标', saved.goal === 'health');

console.log('--- 先上传，再补充信息 ---');
Object.entries({
  mGender: '男', mAge: '45', mHeight: '172', mWeight: '70',
  mRunYears: '1-3 年', mWeeklyVolume: '40', mPace: '630', mHr: '150',
}).forEach(([id, value]) => { getEl(id).value = value; });
getEl('consentHealth').checked = true;
getEl('goal').value = 'full_marathon';
getEl('raceYear').value = String(past.y);
getEl('raceMonth').value = String(past.m);
getEl('raceDay').value = String(past.d);
showWizStep(1);
getEl('btnNextStep').dispatchEvent(new global.Event('click'));
check('未上传图片：仍在第 1 步', getEl('wizPage2').classList.contains('hidden') === false);
check('未上传图片：提示先上传', /先上传/.test(getEl('toast').textContent), 'toast="' + getEl('toast').textContent + '"');

state.images = ['test-image'];
getEl('btnNextStep').dispatchEvent(new global.Event('click'));
check('已上传图片：进入补充信息页', getEl('wizPage2').classList.contains('hidden') === true && getEl('wizPage1').classList.contains('hidden') === false);
check('过期比赛日期在提交页被拦截', /晚于今天/.test(raceDateProblem()));

console.log('--- 表单必填与范围校验 ---');
getEl('mHr').value = '300';
check('异常心率被拦截', /平均心率/.test(metricsProblem()?.message || ''));
getEl('mHr').value = '150';
getEl('mPace').value = '699';
check('错误秒数不会被悄悄改写', /配速格式/.test(metricsProblem()?.message || ''));
getEl('mPace').value = '';
getEl('mHr').value = '';
getEl('mGender').value = '';
getEl('mHeight').value = '';
getEl('mWeight').value = '';
getEl('mRunYears').value = '';
getEl('mWeeklyVolume').value = '';
check('只填年龄时其余指标可留空', metricsProblem() === null);
getEl('goal').value = 'health';
getEl('goal').dispatchEvent(new global.Event('change'));
check('切换健康目标后不提交旧比赛日期', currentRaceDate() === '');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
