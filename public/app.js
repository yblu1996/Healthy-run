const API = '/api';
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const MAX_IMAGES = 10;

const state = {
  token: localStorage.getItem('token') || '',
  user: null,
  images: [],
  diagnosing: false,
  authMode: 'login',
  plan: [],
  planIdx: 0,
};

const GOAL_TEXT = {
  none: '健康跑',
  health: '健康/减脂',
  half_marathon: '半程马拉松',
  full_marathon: '全程马拉松',
};

// 目标徽章：四个目标各自配色，首页统计卡与历史列表共用
const GOAL_STYLE = {
  none: 'goal-none',
  health: 'goal-health',
  half_marathon: 'goal-half',
  full_marathon: 'goal-full',
};
function goalBadge(goal) {
  const text = GOAL_TEXT[goal] || '健康跑';
  const cls = GOAL_STYLE[goal] || GOAL_STYLE.none;
  return `<span class="goal-tag ${cls}">${esc(text)}</span>`;
}

// 模块级 HTML 转义，所有渲染函数共用（此前定义在 renderReport 内部导致历史页报 esc is not defined）
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function showToast(msg, isError) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.background = isError ? '#B3402F' : '#2C2C2A';
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- 网络层：401 自动登出 + 请求超时 ----------
// 诊断接口走 Dify 全链路通常 3-5 分钟；普通接口 30 秒
async function request(path, { method = 'POST', body, isForm = false, timeoutMs } = {}) {
  const opts = { method, headers: {} };
  if (state.token) opts.headers['Authorization'] = 'Bearer ' + state.token;
  if (!isForm) opts.headers['Content-Type'] = 'application/json';
  if (body !== undefined) opts.body = isForm ? body : JSON.stringify(body);

  // high 档实测全链路 ~3 分钟（识图 ~20s + 诊断计划 ~150s），排队时可拖到数分钟；后端硬上限 15 分钟。
  // 前端窗口要大于后端，否则后端还没报超时、前端先放弃，用户看到的就不是服务器给的准确原因。
  // 上传单独放宽到 3 分钟：移动网络传 10 张图（长截图保留原图、单张可到 10MB）30 秒根本传不完
  const tms = timeoutMs || (path.startsWith('/diagnose') ? 960000 : path.startsWith('/upload') ? 180000 : 30000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), tms);
  let res;
  try {
    res = await fetch(API + path, { ...opts, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw Object.assign(
        new Error(path.startsWith('/diagnose')
          ? '分析超时：AI 生成 8 周计划通常需要 3-5 分钟，本次未在 16 分钟内完成。记录已保留在历史中，请稍后到历史记录查看结果，或减少图片后重试'
          : '请求超时，请检查网络后重试'),
        { data: {} }
      );
    }
    throw Object.assign(new Error('网络异常，请检查网络后重试'), { data: {}, network: true });
  }
  clearTimeout(timer);

  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (res.status === 401) {
    showToast('登录已过期，请重新登录', true);
    logout();
    throw Object.assign(new Error(data.error || '登录已过期，请重新登录'), { data });
  }
  if (!res.ok) throw Object.assign(new Error(data.error || '请求失败'), { data, status: res.status });
  return data;
}

// ---------- 通用确认弹窗（替代原生 confirm） ----------
// confirmOpen：防重入——弹窗开着时再按 Enter/点删除会叠加第二个确认框，
// 两个 keydown 监听并存、第一个 promise 悬挂，还会干扰返回拦截的 asking 状态
let confirmOpen = false;
function confirmDialog(message, { title = '请确认' } = {}) {
  if (confirmOpen) return Promise.resolve(false);
  confirmOpen = true;
  return new Promise((resolve) => {
    const modal = $('#confirmModal');
    $('#confirmTitle').textContent = title;
    $('#confirmMessage').textContent = message;
    modal.classList.remove('hidden');
    $('#confirmOk').focus(); // 焦点移入弹窗：触发按钮失焦，键盘不会再次触发它
    const done = (val) => {
      modal.classList.add('hidden');
      $('#confirmOk').onclick = null;
      $('#confirmCancel').onclick = null;
      document.removeEventListener('keydown', onKey);
      confirmOpen = false;
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    $('#confirmOk').onclick = () => done(true);
    $('#confirmCancel').onclick = () => done(false);
  });
}

// ESC 关闭各弹窗/遮罩（确认弹窗的 ESC 由 confirmDialog 自己处理，这里只管其余）。
// 确认框开着时跳过：注销确认框上按 ESC 只关确认框，不能把底下已填好密码的注销弹窗一起带走
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || confirmOpen) return;
  $('#payModal').classList.add('hidden');
  $('#shareOverlay').classList.add('hidden');
  $('#feedbackModal').classList.add('hidden');
  $('#followModal').classList.add('hidden');
  $('#deleteAccountModal').classList.add('hidden');
  closeLearnZoom();
});

// 各页面标题：切页时同步 document.title，分享/收藏/截图时能看到当前页
const PAGE_TITLES = {
  auth: '登录', home: 'AI 跑步诊断', diagnose: '数据诊断',
  report: '诊断报告', history: '历史记录', learn: '学习园地', exit: '已退出',
};
// 页面在界面上的叫法（学习园地的返回按钮文字用它拼）
const PAGE_NAMES = {
  home: '首页', diagnose: '数据诊断', history: '历史记录',
  report: '诊断报告', learn: '学习园地',
};

// 上一个视图：学习园地的返回按钮据此指回"进来之前那一页"，而不是固定回首页
let prevView = 'home';

function show(name) {
  const cur = $('.view.active');
  const curName = cur ? cur.id.replace('view-', '') : '';
  if (curName && curName !== name && PAGE_NAMES[curName]) prevView = curName;
  $$('.view').forEach((v) => v.classList.remove('active'));
  $('#view-' + name).classList.add('active');
  document.title = '跑悟 · ' + (PAGE_TITLES[name] || 'AI 跑步诊断');
  // 桌面与移动导航保持一致，并标记当前页供读屏器识别
  $$('#bottomnav a, .nav-links a').forEach((a) => {
    const active = a.dataset.nav === name;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  // 报告页/学习园地自带吸顶返回栏：移动端顶栏会换行成两行压住它，
  // 这两个页面让顶栏随页面滚动、返回栏顶到 0（见 style.css 的 has-backbar 规则）
  document.body.classList.toggle('has-backbar', name === 'report' || name === 'learn');
  // 学习园地是从哪进来的就退回哪：从历史记录进来的返回历史记录，从首页进来的返回首页
  if (name === 'learn') {
    const back = $('#learnBack');
    back.dataset.nav = prevView;
    back.textContent = '← 返回' + PAGE_NAMES[prevView];
  }
  if (name === 'report') requestAnimationFrame(() => {
    const node = document.getElementById('trendChart');
    const chart = node && window.echarts && echarts.getInstanceByDom(node);
    if (chart) chart.resize();
  });
  window.scrollTo(0, 0);
}

function setLogged(user) {
  state.user = user;
  // 健康数据授权按账号记忆，切换账号时不能沿用上一位用户的勾选
  $('#consentHealth').checked = localStorage.getItem(`consentHealth:${user.id}`) === '1';
  $('#topnav').style.display = 'flex';
  $('#bottomnav').classList.remove('hidden');
  $('#quotaBadge').textContent = user.quota > 0 ? `剩余 ${user.quota} 次` : '次数已用完';
  // 顶部账号信息条：手机号脱敏（138****1234）。
  // 头像用固定图标而不是昵称首字——首字会和后面的昵称连读成"一 一缕春风"，看起来像多打了一个字
  const masked = user.phone ? user.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '';
  $('#userBadge').innerHTML = `<span class="avatar">🏃</span>` +
    `<span class="ub-name">${esc(user.nickname || '跑者')}</span>` +
    (masked ? `<span class="ub-phone">${esc(masked)}</span>` : '');
  armBackGuard();
}

function logout() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('token');
  // 表单记忆（paowu_metrics:<uid>）按账号保留：重登后自动回填；换账号登录读自己的桶，不会串数据
  localStorage.removeItem('consentHealth'); // 清理旧版无账号归属的授权缓存
  $('#consentHealth').checked = false;
  state.images = [];
  state.plan = [];
  renderPreviews();
  METRIC_FIELDS.forEach((id) => { $('#' + id).value = id === 'goal' ? 'none' : ''; });
  $('#mSafetyStatus').value = 'unknown';
  $('#raceMonth').value = '';
  $('#raceDay').value = '';
  $('#raceDateWrap').classList.add('hidden');
  $('#userText').value = '';
  showWizStep(1);
  $('#authForm').reset();
  switchAuth('login');
  $('#statGrid').innerHTML = '';
  $('#historyList').innerHTML = '';
  $('#reportBody').innerHTML = '';
  $('#reportNav').innerHTML = '';
  $('#planBar').classList.add('hidden');
  $('#riskBanner').classList.add('hidden');
  disarmBackGuard();
  $('#topnav').style.display = 'none';
  $('#bottomnav').classList.add('hidden');
  $('#followModal').classList.add('hidden');
  $('#deleteAccountModal').classList.add('hidden');
  $('#userBadge').innerHTML = '';
  show('auth');
}

// ---------- 移动端返回手势/返回键防误触 ----------
// 手机浏览器与微信内置浏览器在页面处于 webview 根部时，从屏幕边缘滑动返回会直接退出程序，
// 用户毫无准备（"滑了一下就出去了"）。登录后压入一条哨兵历史记录，把返回动作变成可拦截的
// popstate 事件：滑动返回先弹确认框，取消就留在本页，确认才离开。
// isMobile 在文件后半部声明；本块里的函数都在脚本求值结束之后才被调用，不存在先用后定义。
// 三个踩过的坑，对应下面三处特殊处理：
//   ① 哨兵原先要等 /auth/me 回来才压入，免密进入时首屏那一两秒里滑动仍会直接掉出去
//      → 有缓存令牌就在脚本末尾先武装（见文件末尾），并在 load/pageshow/重新可见时补压。
//   ② 哨兵被返回动作消费掉后没有立刻补回，连滑两下就漏出去 → popstate 里第一件事就是补压哨兵。
//   ③ 确认退出时只退一级，退到的是本应用的根条目（同一文档，界面纹丝不动），用户得再滑一次才退出
//      → 连退两级；本页就是浏览器第一条记录时退无可退，用"已退出"页收尾（见 exitApp）。
let guardWanted = false;   // 登录态下期望拦截返回
let guardAttached = false; // popstate 监听是否已挂上（武装会被调用多次，别重复挂）
let guardAsking = false;   // 确认框已弹出，避免连滑叠弹窗
let noPrevEntry = false;   // 本页是浏览器里第一条记录（退无可退）
let pageGone = false;      // 页面已经离开（用于判断"退出"有没有真的发生）

function guarded() { return !!(history.state && history.state.pwGuard); }

function pushGuardEntry() {
  if (guarded()) return;
  // 压之前先看清这是第几条记录：等于 1 说明本页之上没有可退的页面
  noPrevEntry = history.length <= 1;
  // 少数内置浏览器禁用 pushState，那就降级为不拦截，别让登录流程整个卡住
  try { history.pushState({ pwGuard: 1 }, ''); } catch (e) { /* 忽略 */ }
}

function onGuardPop() {
  if (!guardWanted) return; // 已确认退出，放行
  // popstate 已经发生，必须立刻把哨兵压回去，否则弹窗期间再滑一下就真退出去了
  pushGuardEntry();
  // 诊断进行中不弹确认框：全屏 loading 遮罩(z-index 180)会盖住弹窗，用户看不见也点不到，
  // guardAsking 悬挂后返回键"失灵"。改为提示后留在本页等分析完成
  if (state.diagnosing) {
    showToast('分析进行中（约 3-5 分钟），请勿离开本页', true);
    return;
  }
  if (guardAsking) return;
  guardAsking = true;
  // 与右上角「退出」按钮的确认框保持同一标题与句式（仅退出对象一词之差），观感统一
  confirmDialog('确定要退出跑悟吗？你的报告会安全保留，下次进入可随时查看。', { title: '退出跑悟' })
    .then((ok) => {
      guardAsking = false;
      if (!ok) return; // 哨兵已补回，用户留在本页
      exitApp();
    });
}

function armBackGuard() {
  // 只在移动端启用：桌面端浏览器返回键走同样的拦截反而别扭
  if (!isMobile) return;
  guardWanted = true;
  pushGuardEntry();
  if (guardAttached) return;
  guardAttached = true;
  window.addEventListener('popstate', onGuardPop);
}
function disarmBackGuard() {
  if (!guardAttached) return;
  guardAttached = false;
  guardWanted = false;
  window.removeEventListener('popstate', onGuardPop);
}
// 哨兵丢了就补回来：首屏加载阶段压入的记录可能不被某些浏览器认账，
// bfcache 恢复、切后台再回来也可能不在原位，这几个时机各补一次
function ensureGuard() {
  if (!guardWanted || guardAsking) return;
  pushGuardEntry();
}
window.addEventListener('load', ensureGuard);
window.addEventListener('pageshow', ensureGuard);
window.addEventListener('pagehide', () => { pageGone = true; });
document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureGuard(); });

// 退出：网页脚本没法关掉浏览器自己，按可用能力从强到弱分三级试
function exitApp() {
  disarmBackGuard();
  pageGone = false;
  // ① 微信/QQ 内置浏览器：官方桥能真正关掉页面（回到聊天窗口），这是唯一"真退出"
  try {
    if (window.WeixinJSBridge && WeixinJSBridge.invoke) WeixinJSBridge.invoke('closeWindow', {}, () => {});
  } catch (e) { /* 非微信环境，走下面两级 */ }
  if (noPrevEntry) { showExitScreenSoon(); return; }
  // ② 连退两级：第一级退回本应用的根条目（同一文档，界面无变化），第二级才是真正的上一页。
  //    只退一级的话会停在本页，用户点完"确定"看着像没反应，得再滑一次才行（旧版就是这个毛病）
  history.back();
  setTimeout(() => {
    history.back();
    // ③ 二级也退不动（极端情况）时兜底，别让用户点完"确定"什么也没发生
    showExitScreenSoon();
  }, 400);
}
function showExitScreenSoon() {
  setTimeout(() => { if (!pageGone && !document.hidden) showExitScreen(); }, 400);
}
// 退无可退时的收尾页：本页可以直接关掉，数据都还在
function showExitScreen() {
  show('exit');
  $('#topnav').style.display = 'none';
  $('#bottomnav').classList.add('hidden');
}

// ---------- 导航（含报告页路由守卫） ----------
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (!nav) return;
  e.preventDefault();
  const target = nav.dataset.nav;
  // 报告内容随刷新丢失，空报告页直接跳回历史列表
  if (target === 'report' && !$('#reportBody').innerHTML.trim()) {
    showToast('报告已保存至历史记录，请从历史记录中查看');
    show('history');
    loadHistory();
    return;
  }
  show(target);
  if (target === 'home') loadHome();
  if (target === 'diagnose') fillMetrics();
  if (target === 'history') loadHistory();
  if (target === 'learn') loadLearn();
});
document.addEventListener('keydown', (e) => {
  const target = e.target.closest('[data-nav][role="button"], .stat-card[role="button"]');
  if (!target || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  target.click();
});

// ---------- 科学跑步学习园地 ----------
// 内容数据在 public/learning.json，增删改内容只需编辑该文件，无需改代码
async function loadLearn() {
  const wrap = $('#learnBody');
  try {
    wrap.innerHTML = '<p class="section-desc">正在加载…</p>';
    const res = await fetch('./learning.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('内容加载失败');
    const data = await res.json();
    renderLearn(data.categories || [], data);
  } catch (err) {
    wrap.innerHTML = '<p class="section-desc">内容加载失败，请稍后重试。</p>';
  }
}

function learnAnimation(m, itemTitle) {
  const caption = m.caption || itemTitle;
  return `<button type="button" class="learn-zoom-trigger" data-learn-zoom="${esc(m.src)}" data-zoom-title="${esc(m.term || caption)}" aria-label="放大查看${esc(caption)}动作动画">
    <img class="learn-img" src="${esc(m.src)}" alt="" loading="lazy">
  </button><div class="fig-tag fig-tag-anim">动作动画 · 点按放大</div>`;
}

function renderLearn(cats, meta) {
  const notes = [];
  if (meta && meta.note) notes.push(`<p class="section-desc">${esc(meta.note)}</p>`);
  if (meta && meta.media_note) notes.push(`<p class="learn-credit">🎬 ${esc(meta.media_note)}</p>`);
  $('#learnBody').innerHTML = notes.join('') + cats
    .map((c) => `
    <div class="learn-cat">
      <h3><span class="learn-icon">${esc(c.icon)}</span>${esc(c.name)}</h3>
      ${(c.items || []).map((it) => `
        <div class="learn-item">
          <button type="button" class="learn-head" aria-expanded="false"><strong>${esc(it.title)}</strong><span class="learn-toggle"></span></button>
          <div class="learn-body">
            <ul>${(it.points || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
            ${(it.media && it.media.length) ? `
            <div class="learn-media">
              ${it.media.map((m) => `
              <figure class="learn-fig">
                <div class="fig-card">
                  ${(m.term || m.caption) ? `
                  <div class="fig-head">
                    ${m.term ? `<div class="fig-title">${esc(m.term)}</div>` : ''}
                    ${m.caption ? `<div class="fig-cap">${esc(m.caption)}</div>` : ''}
                  </div>` : ''}
                  ${m.ref ? `
                  <div class="fig-pair">
                    <div class="fig-pair-cell">
                      <img class="learn-img" src="${esc(m.ref)}" alt="真人动作参考" loading="lazy">
                      <div class="fig-tag">真人参考</div>
                    </div>
                    <div class="fig-pair-cell">
                      ${learnAnimation(m, it.title)}
                    </div>
                  </div>` : (m.refPending ? `
                  <div class="fig-pair">
                    <div class="fig-pair-cell">
                      <div class="fig-pending" role="img" aria-label="参考图待补充">
                        <span class="fig-pending-icon">📷</span>
                        <b>真人参考图待补充</b>
                        <i>找到正确动作照片后替换此占位</i>
                      </div>
                    </div>
                    <div class="fig-pair-cell">
                      ${learnAnimation(m, it.title)}
                    </div>
                  </div>` : learnAnimation(m, it.title))}
                  ${(m.term || m.benefit || (m.muscles && m.muscles.length) || m.caution) ? `
                  <div class="fig-info">
                    ${m.benefit ? `<div class="fig-row"><span class="fig-k">功效</span><span class="fig-v">${esc(m.benefit)}</span></div>` : ''}
                    ${(m.muscles && m.muscles.length) ? `<div class="fig-row"><span class="fig-k">肌肉</span><span class="fig-tags">${m.muscles.map((x) => `<i>${esc(x)}</i>`).join('')}</span></div>` : ''}
                    ${m.caution ? `<div class="fig-row fig-caution"><span class="fig-k">注意</span><span class="fig-v">${esc(m.caution)}</span></div>` : ''}
                  </div>` : ''}
                </div>
              </figure>`).join('')}
            </div>` : ''}
            ${it.note ? `<p class="learn-note">⚠️ ${esc(it.note)}</p>` : ''}
            ${it.image ? `<img class="learn-img" src="${esc(it.image)}" alt="${esc(it.title)}">` : ''}
          </div>
        </div>`).join('')}
    </div>`).join('');
}

// 园地条目折叠（事件委托），同步 aria-expanded 供读屏器感知
document.addEventListener('click', (e) => {
  const head = e.target.closest('.learn-head');
  if (!head) return;
  const item = head.parentElement;
  item.classList.toggle('open');
  head.setAttribute('aria-expanded', item.classList.contains('open') ? 'true' : 'false');
});

let learnZoomReturnFocus = null;
$('#learnBody').addEventListener('click', (e) => {
  const trigger = e.target.closest('.learn-zoom-trigger');
  if (!trigger) return;
  learnZoomReturnFocus = trigger;
  $('#learnZoomTitle').textContent = trigger.dataset.zoomTitle;
  const image = $('#learnZoomImage');
  image.alt = trigger.dataset.zoomTitle + '动作动画';
  image.src = trigger.dataset.learnZoom;
  $('#learnZoomModal').classList.remove('hidden');
  $('#learnZoomClose').focus();
});

function closeLearnZoom() {
  const modal = $('#learnZoomModal');
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  $('#learnZoomImage').removeAttribute('src');
  if (learnZoomReturnFocus?.isConnected) learnZoomReturnFocus.focus();
  learnZoomReturnFocus = null;
}
$('#learnZoomClose').addEventListener('click', closeLearnZoom);
$('#learnZoomModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeLearnZoom();
});
// 退出需确认，防止误触直接掉登录态
$('#btnLogout').addEventListener('click', async () => {
  // 与移动端滑动返回的确认框保持同一标题与句式（仅退出对象一词之差），观感统一
  const ok = await confirmDialog('确定要退出登录吗？你的报告会安全保留，下次登录可随时查看。', { title: '退出跑悟' });
  if (ok) logout();
});

// ---------- 登录 / 注册 / 找回密码 ----------
$('#tabLogin').addEventListener('click', () => switchAuth('login'));
$('#tabRegister').addEventListener('click', () => switchAuth('register'));
$('#forgotLink').addEventListener('click', () => switchAuth('reset'));

function switchAuth(mode) {
  state.authMode = mode;
  $('#tabLogin').classList.toggle('active', mode === 'login');
  $('#tabRegister').classList.toggle('active', mode === 'register');
  $('#nicknameWrap').classList.toggle('hidden', mode !== 'register');
  $('#passwordConfirmWrap').classList.toggle('hidden', mode === 'login');
  // 注册：选密保问题+填答案；找回：显示注册时的密保问题再填答案
  $('#secqWrap').classList.toggle('hidden', mode !== 'register');
  $('#secaWrap').classList.toggle('hidden', !(mode === 'register' || mode === 'reset'));
  $('#resetQuestionWrap').classList.toggle('hidden', mode !== 'reset');
  // 协议同意只在注册时出现：登录和重置密码都不产生新的授权关系
  $('#agreeWrap').classList.toggle('hidden', mode !== 'register');
  if (mode === 'reset') $('#resetQuestionText').textContent = '请先填写手机号';
  // 切换登录/注册/重置时重置弱密码提示的可见性（按当前输入重新判定）
  const pwVal = $('#password').value;
  $('#pwWeakHint').classList.toggle('hidden', mode === 'login' || !pwVal || !pwIsWeak(pwVal));
  $('#forgotLink').classList.toggle('hidden', mode !== 'login');
  $('#passwordLabel').firstChild.textContent = mode === 'reset' ? '新密码' : '密码';
  $('#password').placeholder = mode === 'reset' ? '请输入新密码（至少 6 位）' : '请输入密码';
  $('#authSubmit').textContent = mode === 'register' ? '注册' : mode === 'reset' ? '重置密码' : '登录';
  $('#authSubmit').disabled = false;
}

// 找回密码：手机号填完失焦即拉取该账号的密保问题
$('#phone').addEventListener('input', () => {
  if (state.authMode !== 'reset') return;
  $('#resetQuestionText').textContent = '请先填写手机号';
  $('#secaWrap').classList.remove('hidden');
  $('#authSubmit').disabled = false;
});
$('#phone').addEventListener('blur', async () => {
  if (state.authMode !== 'reset') return;
  const phone = $('#phone').value.trim();
  if (!/^1\d{10}$/.test(phone)) return;
  try {
    const { question } = await request('/auth/security-question', { body: { phone } });
    $('#resetQuestionText').textContent = question
      || '该账号未设置密保问题，暂时无法自助找回（可登录后到首页「密保问题」补设，或通过「反馈」联系管理员）';
    $('#secaWrap').classList.toggle('hidden', !question);
    $('#authSubmit').disabled = !question;
  } catch (e) {
    $('#resetQuestionText').textContent = e.message || '获取密保问题失败，请稍后重试';
  }
});

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const phone = $('#phone').value.trim();
  const password = $('#password').value;

  // 手机号格式前端先拦一道（后端同样校验）
  if (!/^1\d{10}$/.test(phone)) return showToast('请输入正确的 11 位手机号', true);

  // 注册 / 重置密码必须两次输入一致，且密码至少 6 位
  if (state.authMode !== 'login') {
    const confirm = $('#passwordConfirm').value;
    if (password !== confirm) return showToast('两次输入的密码不一致', true);
    if (password.length < 6) return showToast('密码至少 6 位', true);
  }

  const btn = $('#authSubmit');
  btn.disabled = true;
  btn.textContent = '处理中…';
  try {
    if (state.authMode === 'reset') {
      // 未设置密保问题的老账号：给两条可走的路，而不是一句"联系管理员"就把人晾在这
      if ($('#resetQuestionText').textContent.includes('未设置密保问题')) {
        return showToast('该账号未设置密保问题，暂时无法自助找回。若还记得原密码，直接登录后到首页「密保问题」补设；忘记原密码就通过底部「反馈」联系管理员核实后重置', true);
      }
      const ans = $('#secAnswer').value.trim();
      if (ans.length < 2) return showToast('请输入密保答案（至少 2 个字）', true);
      const body = { phone, new_password: password, security_answer: ans };
      const { message } = await request('/auth/reset-password', { body });
      showToast(message || '密码已重置');
      $('#password').value = '';
      $('#passwordConfirm').value = '';
      switchAuth('login');
      return;
    }

    const path = state.authMode === 'register' ? '/auth/register' : '/auth/login';
    const body = { phone, password };
    if (state.authMode === 'register') {
      // 三项同意逐项校验（后端同样强校验，这里先给即时反馈）
      if (!$('#agreeTerms').checked) {
        return showToast('请先阅读并同意《用户服务协议》与《隐私政策》', true);
      }
      if (!$('#agreeCrossBorder').checked) {
        return showToast('请先单独同意个人信息出境存储（内测期数据暂存境外服务器）', true);
      }
      if (!$('#agreeAge').checked) {
        return showToast('请先确认本人已年满 14 周岁', true);
      }
      body.consents = { terms: true, cross_border: true, age: true };
      // 密保问题/答案是日后自助找回密码的唯一凭证，注册时必须设置
      const q = $('#secQuestion').value;
      const ans = $('#secAnswer').value.trim();
      if (!q) return showToast('请选择一个密保问题', true);
      if (ans.length < 2) return showToast('密保答案至少 2 个字，注册后将用于找回密码', true);
      body.security_question = q;
      body.security_answer = ans;
      if ($('#nickname').value.trim()) body.nickname = $('#nickname').value.trim();
    }
    const { token, user } = await request(path, { body });
    localStorage.setItem('token', token);
    state.token = token;
    setLogged(user);
    show('home');
    loadHome();
    // 弱密码（纯数字/过短）登录成功后主动提醒：不强制，但每次登录都会提示直到更换
    if (state.authMode === 'login' && user.weak_password) {
      confirmDialog('你当前的密码是纯数字或过短的弱密码，容易被猜到。建议现在到首页下方「修改密码」换成字母 + 数字组合，要继续吗？', { title: '密码强度提醒' })
        .then((ok) => { if (ok) showToast('请在首页下方「修改密码」处输入当前密码和新密码'); });
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = state.authMode === 'register' ? '注册' : state.authMode === 'reset' ? '重置密码' : '登录';
  }
});

// ---------- 首页档案 ----------
// 卡片布局：已诊断(含剩余次数) / 目标 / 当前状态 / 风险关注(高风险或带健康提醒，点击直达报告)
async function loadHome() {
  try {
    const ownerId = state.user && state.user.id;
    const [{ records }, completed] = await Promise.all([
      request('/records?limit=20', { method: 'GET' }),
      request('/records?limit=1&status=done', { method: 'GET' }),
    ]);
    if (!state.user || state.user.id !== ownerId) return;
    // 密保状态：登录/注册响应可能没带标记，回首页时顺手刷一次
    try {
      const me = await request('/auth/me', { method: 'GET' });
      renderSecqStatus(me.user);
      if (me.user && typeof me.user.security_question_set === 'boolean') {
        state.user = { ...state.user, security_question_set: me.user.security_question_set };
      }
    } catch (e) { /* 状态刷不出来不影响首页其他功能 */ }
    const latest = completed.records[0];
    const quota = state.user ? state.user.quota : 0;
    // 最近一条高风险或有健康提醒的报告（risk_alert 来自 diagnosis.risk_alert）
    const highRisk = records.find((r) => r.status === 'done' && (r.risk_level === '高' || r.risk_alert));

    const cards = [
      {
        label: '已诊断', value: completed.total + ' 次', size: '26px',
        sub: quota > 0 ? `剩余 ${quota} 次` : '次数已用完',
        subDanger: quota <= 0, go: 'history',
      },
      {
        label: '目标', isHtml: latest ? true : false,
        value: latest ? goalBadge(latest.goal) : '未设定', size: '20px', lineH: '2.6',
      },
      {
        label: '当前状态', size: '17px',
        value: latest ? (latest.summary || '点击查看完整报告') : '还没有诊断记录',
        go: latest ? 'history' : '',
      },
      {
        label: highRisk ? '⚠ 风险关注' : '风险关注', size: '17px',
        value: highRisk
          ? (highRisk.risk_alert
            ? (highRisk.risk_alert.length > 80 ? highRisk.risk_alert.slice(0, 80) + '…' : highRisk.risk_alert)
            : (highRisk.summary || '点击查看完整报告'))
          : '暂无高风险，继续保持',
        recordId: highRisk ? highRisk.id : null,
        go: highRisk ? null : 'history',
        danger: !!highRisk,
      },
    ];

    $('#statGrid').innerHTML = cards
      .map((c) => {
        const attr = c.recordId ? ` data-record="${c.recordId}"` : (c.go ? ` data-go="${c.go}"` : '');
        const clickable = attr ? ' style="cursor:pointer"' : '';
        const subHtml = c.sub
          ? `<div class="stat-sub${c.subDanger ? ' danger' : ''}">${esc(c.sub)}</div>`
          : '';
        const shown = c.isHtml ? c.value : esc(c.value);
        return `<div class="stat-card${c.danger ? ' stat-danger' : ''}"${attr}${attr ? ' role="button" tabindex="0"' : ''}${clickable}>
          <div class="label${c.danger ? ' danger' : ''}">${esc(c.label)}</div>
          <div class="value${c.danger ? ' danger' : ''}" style="font-size:${c.size || '18px'};${c.lineH ? 'line-height:' + c.lineH : ''}">${shown}</div>
          ${subHtml}
        </div>`;
      })
      .join('');

    // 周计划进度条需要完整 diagnosis，单独取一次最新记录
    const bar = $('#planBar');
    if (!latest) {
      bar.classList.add('hidden');
      return;
    }
    const { record } = await request('/records/' + latest.id, { method: 'GET' });
    if (!state.user || state.user.id !== ownerId) return;
    const plan = record.diagnosis && Array.isArray(record.diagnosis.plan_8_weeks) ? record.diagnosis.plan_8_weeks : [];
    state.plan = plan;
    if (plan.length) {
      bar.classList.remove('hidden');
      // 每次诊断都重新生成整份计划，计划锚定在记录生成日：过了几整周就是第几周。
      // 头部只留重点文字整行显示（"8 周计划"前缀与 8 个周数圆点已说明总周数），
      // 当前进行周用金色光圈圆点突出
      const cw = planWeekInfo(latest.created_at, plan.length);
      $('#planDots').innerHTML = plan
        .map((w, i) => {
          const isCur = !cw.finished && i === cw.idx;
          return `<button type="button" class="plan-dot${i === cw.idx ? ' active' : ''}${isCur ? ' cur' : ''}" data-i="${i}"${isCur ? ' title="当前进行周"' : ''}>${esc(w.week || i + 1)}</button>`;
        })
        .join('');
      renderPlanWeek(cw.idx);
    } else {
      bar.classList.add('hidden');
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// 打开指定诊断记录的报告（首页风险卡与历史列表共用）
async function openRecord(id) {
  try {
    const { record, is_latest, superseded_at } = await request('/records/' + id, { method: 'GET' });
    if (record.status === 'failed') return showToast('该记录分析失败，可删除后重新提交', true);
    if (record.status !== 'done') return showToast('该记录尚未完成分析，请稍后再看', true);
    // 状态是 done 但内容为空（历史脏数据）：走"内容不完整"卡，别把外壳对象渲染成伪报告
    if (!record.diagnosis || typeof record.diagnosis !== 'object') {
      renderReport({ diagnosis_result: null, recognition: record.recognition || null });
      show('report');
      return;
    }
    renderReport({
      diagnosis_result: record.diagnosis,
      recognition: record.recognition || null,
      meta: { created_at: record.created_at, is_latest: is_latest !== false, superseded_at: superseded_at || null },
    });
    show('report');
  } catch (err) {
    showToast(err.message, true);
  }
}

// 档案卡点击跳转（模块级只绑一次；data-record 直达报告，data-go 切页）
$('#statGrid').addEventListener('click', (e) => {
  const card = e.target.closest('[data-record], [data-go]');
  if (!card) return;
  if (card.dataset.record) return openRecord(card.dataset.record);
  show(card.dataset.go);
  if (card.dataset.go === 'history') loadHistory();
  if (card.dataset.go === 'learn') loadLearn();
});

// ---------- 首页 8 周计划：选周 / 滑动 / 详情 ----------
function renderPlanWeek(i) {
  const plan = state.plan;
  if (!plan.length) return;
  const idx = Math.max(0, Math.min(plan.length - 1, i));
  state.planIdx = idx;
  const w = plan[idx];
  const weekNo = w.week || idx + 1;

  $('#planFocus').textContent = `8 周计划 · 第 ${weekNo} 周重点：${w.focus || '—'}`;
  $('#planFill').style.width = ((idx + 1) / plan.length * 100) + '%';
  $$('#planDots .plan-dot').forEach((d, k) => d.classList.toggle('active', k === idx));

  const runs = (Array.isArray(w.runs) ? w.runs : [])
    .map((r) => `<div class="pw-run"><span class="pw-day">${esc(r.day)}</span><span class="pw-type">${esc(r.type)}</span><span>${esc(r.detail)}</span></div>`)
    .join('');
  $('#planWeekDetail').innerHTML = `
    <div class="pw-head">第 ${esc(weekNo)} 周 · 周跑量 ${esc(w.weekly_volume_km ?? '—')} km</div>
    ${runs || '<p class="issue-evidence">本周无具体安排</p>'}
    ${w.note ? `<div class="pw-note">${esc(w.note)}</div>` : ''}`;
}

// 圆点点击选周
$('#planDots').addEventListener('click', (e) => {
  const dot = e.target.closest('.plan-dot');
  if (dot) renderPlanWeek(Number(dot.dataset.i));
});

// 轨道滑动选周（按手指在轨道上的位置定位到对应周）
const planTrack = $('#planTrack');
let planDragging = false;
function planWeekFromX(clientX) {
  const rect = planTrack.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.floor(ratio * state.plan.length);
}
planTrack.addEventListener('pointerdown', (e) => {
  if (!state.plan.length) return;
  planDragging = true;
  planTrack.setPointerCapture(e.pointerId);
  renderPlanWeek(planWeekFromX(e.clientX));
});
planTrack.addEventListener('pointermove', (e) => {
  if (planDragging) renderPlanWeek(planWeekFromX(e.clientX));
});
planTrack.addEventListener('pointerup', () => { planDragging = false; });
planTrack.addEventListener('pointercancel', () => { planDragging = false; });

// ---------- 配速输入自动格式化：603 → 6'03"/km，630 → 6'30"/km ----------
// 解析纯数字：3 位 = 分+秒，4 位 = 前两位为分；错误秒数留给表单校验提示
function normalizePace(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  // 已包含 ' 或 " 的，视为用户已按格式手填，原样返回
  if (/[''"]/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) return s;
  let mins, secs;
  if (digits.length <= 2) { mins = Number(digits); secs = 0; }
  else if (digits.length === 3) { mins = Number(digits[0]); secs = Number(digits.slice(1)); }
  else { mins = Number(digits.slice(0, -2)); secs = Number(digits.slice(-2)); }
  return `${mins}'${String(secs).padStart(2, '0')}"`;
}
const paceInput = $('#mPace');
paceInput.addEventListener('blur', () => {
  const v = normalizePace(paceInput.value);
  if (v) paceInput.value = v + '/km';
});
paceInput.addEventListener('focus', () => {
  // 聚焦时去掉 /km 后缀，方便修改
  paceInput.value = paceInput.value.replace(/\/km$/, '');
});

// ---------- 心率输入范围校验 ----------
const hrInput = $('#mHr');
hrInput.addEventListener('blur', () => {
  const raw = hrInput.value.trim();
  if (raw === '') return;
  const v = Number(raw);
  if (!Number.isFinite(v)) return;
  if (v < 40 || v > 220) {
    hrInput.value = '';
    showToast('心率 ' + raw + ' 明显超出可能范围（40-220），请核对后重新填写，如把 142 误输成 412', true);
    return;
  }
});

// ---------- 上传图片（本地压缩） ----------
const uploadArea = $('#uploadArea');
const fileInput = $('#fileInput');
let uploading = false;

uploadArea.addEventListener('click', (e) => {
  if (!$('#consentHealth').checked) return showToast('请先同意处理健康数据，再上传图片', true);
  if (e.target !== fileInput && !uploading) fileInput.click();
});
uploadArea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!$('#consentHealth').checked) return showToast('请先同意处理健康数据，再上传图片', true);
    fileInput.click();
  }
});
uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.style.borderColor = 'var(--teal)'; });
uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = ''; });
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.style.borderColor = '';
  if (e.dataTransfer.files.length) uploadFiles([...e.dataTransfer.files]);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) uploadFiles([...e.target.files]);
  fileInput.value = '';
});

// 单张图片上限 2MB（与后端 multer 限制一致）。普通图压到长边 1600px；
// 运动曲线长截图保持原分辨率：例如 1152×9671 若按长边压缩，文字宽度只剩约 190px，识图无法读数。
// 超 2MB 的长截图按原尺寸降 JPEG 质量重编码——截图以白底文字为主，降质量体积敏感、清晰度不敏感
const MAX_IMG_BYTES = 2 * 1024 * 1024;

function encodeJpeg(img, width, height, quality) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))), 'image/jpeg', quality);
  });
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) {
      return reject(new Error('只能上传图片文件'));
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        try {
          if (Math.max(img.width, img.height) / Math.min(img.width, img.height) >= 2.5) {
            if (file.size <= MAX_IMG_BYTES) return resolve(file);
            for (const q of [0.65, 0.45]) {
              const blob = await encodeJpeg(img, img.width, img.height, q);
              if (blob.size <= MAX_IMG_BYTES) return resolve(blob);
            }
            return reject(new Error('长截图压缩后仍超过 2MB，请分段截图后再上传'));
          }
          const fit = (maxSide) => {
            let { width, height } = img;
            if (width > maxSide || height > maxSide) {
              const r = width >= height ? maxSide / width : maxSide / height;
              width = Math.round(width * r);
              height = Math.round(height * r);
            }
            return [width, height];
          };
          // 三档递进压进 2MB：1600px@0.82 → 同尺寸降质 0.6 → 1280px@0.6
          let blob = await encodeJpeg(img, ...fit(1600), 0.82);
          if (blob.size > MAX_IMG_BYTES) blob = await encodeJpeg(img, ...fit(1600), 0.6);
          if (blob.size > MAX_IMG_BYTES) blob = await encodeJpeg(img, ...fit(1280), 0.6);
          if (blob.size > MAX_IMG_BYTES) {
            return reject(new Error('图片压缩后仍超过 2MB，请换一张更小的图片'));
          }
          resolve(blob.size < file.size ? blob : file);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

async function uploadFiles(files) {
  if (!$('#consentHealth').checked) return showToast('请先同意处理健康数据，再上传图片', true);
  if (uploading) return showToast('图片正在上传，请稍候', true);
  const left = MAX_IMAGES - state.images.length;
  if (left <= 0) return showToast(`最多上传 ${MAX_IMAGES} 张图片`, true);
  if (files.length > left) {
    showToast(`一次最多 ${MAX_IMAGES} 张，已忽略多出的 ${files.length - left} 张`);
    files = files.slice(0, left);
  }

  uploading = true;
  const ownerId = state.user && state.user.id;
  uploadArea.classList.add('is-uploading');
  fileInput.disabled = true;
  showToast('图片处理中…');
  try {
    const compressed = [];
    for (const f of files) compressed.push(await compressImage(f));

    const fd = new FormData();
    compressed.forEach((f, i) => fd.append('images', f, f.name || `image_${i}.jpg`));

    showToast('上传中…');
    const { urls } = await request('/upload', { body: fd, isForm: true });
    if (!state.user || state.user.id !== ownerId) return;
    state.images = state.images.concat(urls);
    renderPreviews();
    showToast(`已上传 ${urls.length} 张图片`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    uploading = false;
    uploadArea.classList.remove('is-uploading');
    fileInput.disabled = false;
  }
}

function renderPreviews() {
  $('#previewGrid').innerHTML = state.images
    .map((url, i) => `<div class="preview-item"><img src="${esc(url)}" alt="跑步数据"><button class="preview-del" data-i="${i}" aria-label="删除第 ${i + 1} 张图片">×</button></div>`)
    .join('');
  const cnt = $('#uploadCount');
  if (cnt) cnt.textContent = state.images.length ? `已上传 ${state.images.length} / ${MAX_IMAGES} 张` : '';
  // 上传后压缩上传区：隐藏长说明避免与缩略图挤在一起（微信内置浏览器下尤甚），也缩短页面
  $('#uploadArea').classList.toggle('compact', state.images.length > 0);
  if (state.images.length) {
    $('.upload-area > p:nth-child(2)').textContent = '继续添加图片';
  } else {
    $('.upload-area > p:nth-child(2)').textContent = '点击或拖拽图片到此处';
  }
}

$('#previewGrid').addEventListener('click', (e) => {
  const del = e.target.closest('.preview-del');
  if (del) {
    state.images.splice(Number(del.dataset.i), 1);
    renderPreviews();
  }
});

// ---------- 核心数据本地记忆（性别/年龄/身高/步频等不重复录入） ----------
// 选了半马/全马时连带记忆比赛日期；退出登录会清空，避免账号间串数据
// 症状自评每次重新选择，不从上一次提交或本地缓存沿用。
const METRIC_FIELDS = ['mGender','mAge','mHeight','mWeight','mRunYears','mWeeklyVolume','mPace','mHr','mCadence','goal'];
// 按账号分桶记忆：退出登录不清除（重登后自动回填），换账号登录也不会串到别人的数据
function metricsKey() {
  return state.user ? `paowu_metrics:${state.user.id}` : 'paowu_metrics';
}
function saveMetrics() {
  const data = {};
  ['goal', ...METRIC_FIELDS, 'raceYear', 'raceMonth', 'raceDay'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  try { localStorage.setItem(metricsKey(), JSON.stringify(data)); } catch (e) {}
}
function fillMetrics() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(metricsKey()) || '{}'); } catch (e) { return; }
  // 迁移：按账号分桶之前的老缓存（paowu_metrics 无账号归属）。只迁移一次并立即删除：
  // 静默留给后续其它账号登录回填，会把前任用户的身高体重心率填进新账号的表单
  if (!Object.keys(data).length) {
    try { data = JSON.parse(localStorage.getItem('paowu_metrics') || '{}'); } catch (e) { data = {}; }
    if (Object.keys(data).length) {
      try { localStorage.setItem(metricsKey(), JSON.stringify(data)); } catch (e) {}
      localStorage.removeItem('paowu_metrics');
    }
  }
  if (!Object.keys(data).length) return;
  METRIC_FIELDS.forEach((id) => {
    const el = document.getElementById(id);
    if (el && data[id]) el.value = data[id];
  });
  // 比赛日期三联下拉：每级 change 会重建下一级的选项，必须 年→月→日 顺序触发，反了选不上
  // goal 的 change 无论值是什么都要触发，让日期区的显隐与目标保持同步
  const goalEl = document.getElementById('goal');
  if (data.goal) goalEl.dispatchEvent(new Event('change'));
  if (data.goal === 'half_marathon' || data.goal === 'full_marathon') {
    const y = document.getElementById('raceYear');
    const m = document.getElementById('raceMonth');
    const d = document.getElementById('raceDay');
    if (data.raceYear) { y.value = data.raceYear; y.dispatchEvent(new Event('change')); }
    if (data.raceMonth) { m.value = data.raceMonth; m.dispatchEvent(new Event('change')); }
    if (data.raceDay) d.value = data.raceDay;
  }
}
$('#diagnoseForm').addEventListener('input', saveMetrics);
$('#diagnoseForm').addEventListener('change', saveMetrics);

// ---------- 目标联动 ----------
$('#goal').addEventListener('change', (e) => {
  const show = e.target.value !== 'none' && e.target.value !== 'health';
  $('#raceDateWrap').classList.toggle('hidden', !show);
  if (!show) {
    $('#raceMonth').value = '';
    fillRaceDays();
  }
  // 展开时按当前日期刷新年份范围（滚动递进，不会出现"4 年后选不了"）
  if (show) refreshRaceYears();
});

// ---------- 比赛日期：年/月/日三段下拉（替代原生 date 控件，年份选择更醒目） ----------
const raceYear = $('#raceYear');
const raceMonth = $('#raceMonth');
const raceDay = $('#raceDay');
// 年份按"打开时的当前年 ~ +3"滚动生成：每年自动递进，永不过期
function refreshRaceYears() {
  const y = new Date().getFullYear();
  const selected = raceYear.value;
  raceYear.innerHTML = '';
  for (let i = 0; i <= 3; i++) raceYear.appendChild(new Option((y + i) + ' 年', String(y + i)));
  if (selected && Number(selected) >= y && Number(selected) <= y + 3) raceYear.value = selected;
  fillRaceDays();
}
raceMonth.appendChild(new Option('月', ''));
for (let m = 1; m <= 12; m++) raceMonth.appendChild(new Option(m + ' 月', String(m)));
refreshRaceYears();
raceYear.addEventListener('change', fillRaceDays);
raceMonth.addEventListener('change', fillRaceDays);
function fillRaceDays() {
  const y = Number(raceYear.value);
  const m = Number(raceMonth.value);
  raceDay.innerHTML = '';
  raceDay.appendChild(new Option('日', ''));
  const days = y && m ? new Date(y, m, 0).getDate() : 31;
  for (let d = 1; d <= days; d++) raceDay.appendChild(new Option(d + ' 日', String(d)));
}
function currentRaceDate() {
  if (!['half_marathon', 'full_marathon'].includes($('#goal').value)) return '';
  if (raceYear.value && raceMonth.value && raceDay.value) {
    return `${raceYear.value}-${String(raceMonth.value).padStart(2, '0')}-${String(raceDay.value).padStart(2, '0')}`;
  }
  return '';
}

// 比赛日期校验：返回提示文案，空串表示通过
// ① 半马/全马必须选完整的年月日（只选年或只选年月，工作流拿到的日期是残缺的）
// ② 选完整后还要晚于今天，否则生成出来的备战计划会整段过期
function raceDateProblem() {
  const goal = document.getElementById('goal').value;
  if (goal !== 'half_marathon' && goal !== 'full_marathon') return '';
  if (!raceYear.value || !raceMonth.value || !raceDay.value) return '请选择完整的比赛日期（年、月、日）';
  const picked = new Date(Number(raceYear.value), Number(raceMonth.value) - 1, Number(raceDay.value));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (picked.getTime() <= today.getTime()) return '比赛日期需晚于今天，请重新选择目标比赛日期';
  return '';
}

// ---------- 两步向导：① 上传图片 → ② 补充信息并提交 ----------
function showWizStep(n) {
  $('#wizPage1').classList.toggle('hidden', n !== 2);
  $('#wizPage2').classList.toggle('hidden', n !== 1);
  $('#wizStep1').classList.toggle('active', n === 1);
  $('#wizStep2').classList.toggle('active', n === 2);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
// 健康数据同意按账号记忆，避免不同账号在同一台设备上共用授权状态
$('#consentHealth').addEventListener('change', (e) => {
  if (!state.user) return;
  const key = `consentHealth:${state.user.id}`;
  if (e.target.checked) localStorage.setItem(key, '1');
  else localStorage.removeItem(key);
});

function metricsProblem() {
  const required = [['mAge', '年龄']];
  for (const [id, name] of required) {
    if (!$('#' + id).value.trim()) return { id, message: '请填写' + name };
  }
  const ranges = [
    ['mAge', 14, 100, '年龄', true], ['mHeight', 100, 250, '身高'],
    ['mWeight', 20, 300, '体重'], ['mWeeklyVolume', 0, 500, '最近 7 天累计跑量'],
    ['mHr', 40, 220, '平均心率', true], ['mCadence', 50, 300, '步频', true],
  ];
  for (const [id, min, max, name, integer] of ranges) {
    const raw = $('#' + id).value.trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      return { id, message: `${name}请填 ${min}–${max} 之间的${integer ? '整数' : '数字'}` };
    }
  }
  if ($('#mPace').value.trim()) {
    const pace = normalizePace($('#mPace').value.replace(/\/km$/, ''));
    const parts = /^(\d{1,2})'(\d{2})"$/.exec(pace);
    if (!parts || Number(parts[1]) < 2 || Number(parts[1]) > 30 || Number(parts[2]) > 59) {
      return { id: 'mPace', message: '配速格式不正确，请输入如 630 或 6\'30"' };
    }
  }
  if ($('#mSafetyStatus').value === 'concerning') return {
    id: 'mSafetyStatus', message: '出现上述警示症状时，应先由专业人员评估；本服务暂不生成训练计划，也不会扣次数',
  };
  return null;
}

function checkMetrics() {
  const problem = metricsProblem();
  if (!problem) return true;
  if ($('#wizPage1').classList.contains('hidden')) showWizStep(2);
  showToast(problem.message, true);
  const field = $('#' + problem.id);
  field.focus();
  return false;
}

$('#btnNextStep').addEventListener('click', () => {
  if (!$('#consentHealth').checked) {
    return showToast('请先勾选同意处理你的健康数据，再进入下一步', true);
  }
  if (uploading) return showToast('图片正在上传，请稍候', true);
  if (!state.images.length) return showToast('请先上传至少一张跑步图片', true);
  showWizStep(2);
});
$('#btnPrevStep').addEventListener('click', () => showWizStep(1));

// ---------- 提交诊断 ----------
// 分段提示：告诉用户当前进行到哪一步，缓解 1-3 分钟等待的焦虑
let stageTimers = null;
function startLoadingStages() {
  // 用步骤完成度代替转圈：已完成的步骤打勾，当前步骤脉冲呼吸，比无限旋转不容易让人头晕
  const items = $$('#loadingSteps [data-step]');
  const count = $('#loadingCount');
  if (!items.length) return;
  stopLoadingStages();

  const total = items.length;
  let done = 0;
  // 节奏按 SSE 实测对齐：工作流启动 ~3s、识图节点 ~20s（队列空闲时）～60s（排队时）、诊断计划节点 ~150s～480s。
  // 服务端排队会让同一档跑出 2-4 倍差异，所以打勾节奏取得比最快实测更保守（宁可进度条走得慢，也不要跑在真实进度前面）。
  // 前 3 步打勾，第 4 步只保持脉冲"进行中"，直到接口真实返回——这一步对应诊断节点的逐周计划生成，本身就是最慢的一段。
  const stepTimes = [0, 70 * 1000, 200 * 1000];
  const timers = [];

  const render = () => {
    items.forEach((li, i) => {
      li.classList.toggle('done', i < done);
      li.classList.toggle('active', i === done);
    });
    count.textContent = `已完成 ${done} / ${total} 步`;
  };
  render();

  stepTimes.forEach((ms, i) => {
    timers.push(setTimeout(() => {
      // 最后一次最多标记到 total-1，保证"生成计划"始终是进行中、而非已完成
      done = Math.min(i + 1, total - 1);
      render();
    }, ms));
  });
  // 明显超时仍未返回：如实提示当前在做什么、还要多久，不制造"马上就好"的假象
  timers.push(setTimeout(() => {
    count.textContent = '正在逐周生成 8 周训练计划，这一步最慢，通常 3-5 分钟内完成，请再稍候…';
  }, 420 * 1000));
  stageTimers = timers;
}
function stopLoadingStages() {
  if (stageTimers) { stageTimers.forEach(clearTimeout); stageTimers = null; }
}

$('#diagnoseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  // 防重入：提交按钮 disabled 之外再挡一道（个别老内核 Enter 隐式提交不受 disabled 影响）
  if (state.diagnosing) return;
  if (!checkMetrics()) return;
  if (uploading) return showToast('图片正在上传，请等待上传完成', true);
  if (!state.images.length) return showToast('请先上传至少一张图片', true);
  // 兜底：用户可能返回第 1 步取消了健康数据授权。
  if (!$('#consentHealth').checked) {
    showWizStep(1);
    return showToast('请先在第 1 步勾选同意处理你的健康数据', true);
  }
  // 提交前再次检查比赛日期。
  const dateProblem = raceDateProblem();
  if (dateProblem) return showToast(dateProblem, true);

  // 配速兜底：已格式化的原样返回，纯数字的自动转成 6'03"/km
  const m = {
    gender: $('#mGender').value,
    age: $('#mAge').value,
    height: $('#mHeight').value,
    weight: $('#mWeight').value,
    run_years: $('#mRunYears').value,
    weekly_volume: $('#mWeeklyVolume').value,
    avg_pace: normalizePace($('#mPace').value),
    avg_hr: $('#mHr').value,
  };
  const btn = $('#diagnoseSubmit');
  btn.disabled = true;
  state.diagnosing = true;
  $('#loadingOverlay').classList.remove('hidden');
  startLoadingStages();

  try {
    const { result, recognition } = await request('/diagnose', {
      body: {
        images: state.images,
        user_text: $('#userText').value.trim(),
        goal: $('#goal').value,
        race_date: currentRaceDate(),
        consent_health: $('#consentHealth').checked,
        safety_status: $('#mSafetyStatus').value,
        ...m,
        cadence: $('#mCadence').value,
      },
    });
    // 本次完成：清空表单并回到向导第 1 步，下次进来是干净状态
    state.images = [];
    renderPreviews();
    $('#userText').value = '';
    $('#mSafetyStatus').value = 'unknown';
    showWizStep(1);
    renderReport({ ...result, recognition: recognition || result.recognition || null });
    show('report');
    showToast('报告已保存至历史记录');
    // 配额刷新独立于主 try：诊断已经成功，刷新失败不该把用户吓成"以为白跑一次"
    try {
      const me = await request('/auth/me', { method: 'GET' });
      setLogged(me.user);
    } catch (e) { /* 剩余次数徽章暂不更新，下次进首页会刷 */ }
  } catch (err) {
    if (err.data && err.data.need_pay) {
      try {
        const pay = await request('/pay/availability', { method: 'GET' });
        if (pay.mock_enabled) $('#payModal').classList.remove('hidden');
        else showToast('诊断次数已用完，支付通道暂未开放', true);
      } catch {
        showToast('诊断次数已用完，支付通道暂未开放', true);
      }
    } else {
      // 扣子慢或网络抖动时，可能后端已落库成功但响应丢失；引导用户去历史记录确认，避免误以为白跑一次
      showToast(err.message + '；若历史记录里已出现该次诊断，可直接点开查看结果', true);
    }
  } finally {
    state.diagnosing = false;
    stopLoadingStages();
    $('#loadingOverlay').classList.add('hidden');
    btn.disabled = false;
  }
});

// 分析进行中拦截刷新，避免图片与报告丢失
window.addEventListener('beforeunload', (e) => {
  if (state.diagnosing) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------- 非生产环境的模拟充值 ----------
$('#payCancel').addEventListener('click', () => $('#payModal').classList.add('hidden'));
$('#payConfirm').addEventListener('click', async () => {
  const btn = $('#payConfirm');
  btn.disabled = true;
  btn.textContent = '处理中…';
  try {
    await request('/pay');
    $('#payModal').classList.add('hidden');
    showToast('充值成功，已到账 1 次，请重新提交');
    // 配额刷新独立于主 try：充值已成功，刷新失败不该弹"充值失败"吓用户
    try {
      const me = await request('/auth/me', { method: 'GET' });
      setLogged(me.user);
    } catch (e) { /* 徽章暂不更新，回首页会刷 */ }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '模拟增加 1 次';
  }
});

// ---------- 意见反馈 ----------
// 联系方式选填，但填了必须是 11 位手机号或正确邮箱（防止乱填导致无法回访）
function validContact(v) {
  const s = String(v || '').trim();
  if (!s) return true;
  return /^1\d{10}$/.test(s) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
const feedbackContactInput = $('#feedbackContact');
feedbackContactInput.addEventListener('blur', () => {
  const v = feedbackContactInput.value.trim();
  if (v && !validContact(v)) {
    showToast('联系方式格式不对：请填 11 位手机号（1 开头）或正确的邮箱', true);
  }
});

// ---------- 顶栏「关注」弹窗 ----------
// 四页共用同一个入口（顶栏是全局的），点遮罩空白处也能关，跟其他弹窗行为一致
$('#btnFollow').addEventListener('click', () => $('#followModal').classList.remove('hidden'));
$('#followClose').addEventListener('click', () => $('#followModal').classList.add('hidden'));
$('#followModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

$('#btnFeedback').addEventListener('click', () => {
  $('#feedbackContent').value = '';
  $('#feedbackContact').value = '';
  $('#feedbackModal').classList.remove('hidden');
  $('#feedbackContent').focus();
});
$('#feedbackCancel').addEventListener('click', () => $('#feedbackModal').classList.add('hidden'));
$('#feedbackForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = $('#feedbackContent').value.trim();
  const contact = $('#feedbackContact').value.trim();
  if (content.length < 5) return showToast('反馈内容至少 5 个字', true);
  if (!validContact(contact)) return showToast('联系方式格式不对：请填 11 位手机号或正确的邮箱', true);

  const btn = $('#feedbackSubmit');
  btn.disabled = true;
  btn.textContent = '提交中…';
  try {
    await request('/feedback', { body: { content, contact: contact || null } });
    $('#feedbackModal').classList.add('hidden');
    showToast('感谢反馈！我们会尽快处理');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '提交反馈';
  }
});

// ---------- 密保问题：状态显示 + 补设/更换 ----------
// 老账号（密保字段上线前注册的）登录后在此补设；忘答的也可以直接换一套
function renderSecqStatus(user) {
  if (!user || !$('#secqStatusText')) return;
  const set = !!user.security_question_set;
  $('#secqStatusText').textContent = set ? '已设置密保问题' : '未设置密保问题';
  $('#secqStatusHint').textContent = set
    ? '如需更换，选一个新问题并填写新答案后保存即可'
    : '未设置密保的账号无法自助找回密码，建议现在就设置';
}

$('#btnSaveSecq').addEventListener('click', async () => {
  const question = $('#acctSecQuestion').value;
  const answer = $('#acctSecAnswer').value.trim();
  const currentPassword = $('#acctSecPassword').value;
  if (!question) return showToast('请选择一个密保问题', true);
  if (answer.length < 2) return showToast('密保答案至少 2 个字，请务必牢记', true);
  if (!currentPassword) return showToast('请输入当前密码，确认是本人操作', true);
  const btn = $('#btnSaveSecq');
  btn.disabled = true;
  try {
    await request('/auth/set-security', { body: { security_question: question, security_answer: answer, current_password: currentPassword } });
    $('#acctSecAnswer').value = '';
    $('#acctSecPassword').value = '';
    renderSecqStatus({ security_question_set: true });
    showToast('密保已保存，请牢记问题和答案');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// 密码强度实时提示（注册/重置模式）：纯数字或不足 8 位时提示，不强制阻断
function pwIsWeak(pw) {
  return /^\d+$/.test(pw) || pw.length < 8;
}
$('#password').addEventListener('input', () => {
  const hint = $('#pwWeakHint');
  const val = $('#password').value;
  if (state.authMode === 'login' || !val) {
    hint.classList.add('hidden');
    return;
  }
  hint.classList.toggle('hidden', !pwIsWeak(val));
});

$('#btnChangePassword').addEventListener('click', async () => {
  const current = $('#chpwCurrent').value;
  const next = $('#chpwNew').value;
  const confirm2 = $('#chpwConfirm').value;
  if (!current) return showToast('请输入当前密码', true);
  if (!next || next.length < 6) return showToast('新密码至少 6 位', true);
  if (next !== confirm2) return showToast('两次输入的新密码不一致', true);
  if (next === current) return showToast('新密码不能与当前密码相同', true);
  const btn = $('#btnChangePassword');
  btn.disabled = true;
  try {
    const { weak_password } = await request('/auth/change-password', { body: { current_password: current, new_password: next } });
    $('#chpwCurrent').value = '';
    $('#chpwNew').value = '';
    $('#chpwConfirm').value = '';
    if (state.user) state.user.weak_password = weak_password;
    showToast(pwIsWeak(next) ? '密码已修改；新密码仍偏简单，建议改成字母 + 数字组合' : '密码已修改，下次登录请使用新密码');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ---------- 账号与数据：导出 / 注销 ----------
// 落地上传文件有两条路：
//   · 桌面端走 <a download>：直接存进「下载」文件夹，这是桌面用户真正想要的，
//     不能因为 navigator.canShare 在桌面 Chrome 上也为真就弹系统分享面板（那是多此一举）。
//   · 触屏端走 Web Share API：手机浏览器（尤其微信内置浏览器）会忽略 <a download>，
//     而系统分享面板能"存到文件 / 发给微信 / 发给自己"，是手机上唯一可靠的落地方式。
// 分享这条路上出任何岔子（无用户手势、系统不支持）都必须退回下载，不能把文件丢掉。
function saveFile(file, name) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立即 revoke 会让部分浏览器来不及取到数据，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$('#btnExportData').addEventListener('click', async () => {
  const btn = $('#btnExportData');
  btn.disabled = true;
  btn.textContent = '打包中…';
  try {
    const data = await request('/account/export', { method: 'GET' });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const name = `跑悟数据导出-${stamp}.json`;
    const file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });

    const isTouch = (navigator.maxTouchPoints || 0) > 0;
    if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        showToast('数据已导出');
        return;
      } catch (e) {
        // 用户在分享面板上主动取消：这是他自己的选择，不当失败处理
        if (e && e.name === 'AbortError') return;
        // 其它原因失败（无用户手势、系统不支持等）继续往下走下载兜底，不能什么都不发生
      }
    }
    saveFile(file, name);
    showToast('数据已导出');
  } catch (err) {
    showToast(err.message || '导出失败，请稍后重试', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '导出';
  }
});

$('#btnDeleteAccount').addEventListener('click', () => {
  $('#delPassword').value = '';
  $('#delConfirmWord').value = '';
  $('#deleteAccountModal').classList.remove('hidden');
  $('#delPassword').focus();
});
$('#delAccountCancel').addEventListener('click', () => $('#deleteAccountModal').classList.add('hidden'));
$('#deleteAccountModal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

$('#deleteAccountForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('#delPassword').value;
  const confirm = $('#delConfirmWord').value.trim();
  if (confirm !== '注销') return showToast('请手动输入「注销」两个字以确认', true);
  if (!password) return showToast('请输入登录密码', true);

  // 第三道确认：手输完不是直接删，再给一次"看清后果"的机会
  const sure = await confirmDialog(
    '最后确认：账号、全部诊断记录与上传的跑步图片将被永久删除，无法恢复。确定要注销吗？',
    { title: '永久删除，不可恢复' }
  );
  if (!sure) return;

  const btn = $('#delAccountSubmit');
  btn.disabled = true;
  btn.textContent = '注销中…';
  try {
    await request('/account', { method: 'DELETE', body: { password, confirm } });
    $('#deleteAccountModal').classList.add('hidden');
    if (state.user) localStorage.removeItem(`consentHealth:${state.user.id}`);
    // 先登出再提示：账号已不存在，旧令牌留在本地只会让用户以为还能操作
    logout();
    showToast('账号已注销，全部数据已删除');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '确认注销';
  }
});

// ---------- 报告渲染 ----------
const RISK_ICON = { 高: '⚠️', 中: '⚡', 低: '✓' };

// 识图指标展示配置：报告页「截图识别到的数据」卡片按此顺序渲染
// 字段名与 Dify 识图节点 metrics 白名单一一对应，改白名单时要同步改这里
const RECOG_GROUPS = [
  {
    title: '基础数据',
    items: [
      ['distance_km', '距离', 'km'],
      ['duration_min', '时长', '分钟'],
      ['avg_pace_min_per_km', '平均配速', '/km'],
      ['fastest_pace_min_per_km', '最快配速', '/km'],
      ['avg_heart_rate', '平均心率', 'bpm'],
      ['max_heart_rate', '最大心率', 'bpm'],
      ['cadence_spm', '步频', 'spm'],
      ['weekly_volume_km', '近 7 天跑量', 'km'],
      ['elevation_gain_m', '爬升', 'm'],
      ['steps', '步数', '步'],
      ['avg_speed_kmh', '平均速度', 'km/h'],
      ['total_calories_kcal', '总消耗', '千卡'],
      ['active_calories_kcal', '活动消耗', '千卡'],
    ],
  },
  {
    title: '跑姿与体能',
    items: [
      ['avg_stride_cm', '平均步幅', 'cm'],
      ['ground_contact_time_ms', '触地时间', 'ms'],
      ['vertical_oscillation_cm', '垂直振幅', 'cm'],
      ['vo2max', '最大摄氧量', ''],
      ['aerobic_training_effect', '有氧训练压力', ''],
      ['anaerobic_training_effect', '无氧训练压力', ''],
      ['recovery_hours', '建议恢复时间', '小时'],
    ],
  },
];

// 配速统一成 5'49" 显示：识别结果可能是十进制分钟 5.82，也可能已是 5'49"
function formatPaceValue(v) {
  if (typeof v === 'number' && isFinite(v)) {
    let mins = Math.floor(v);
    let secs = Math.round((v - mins) * 60);
    if (secs === 60) { mins += 1; secs = 0; }
    return `${mins}'${String(secs).padStart(2, '0')}"`;
  }
  return normalizePace(v);
}

// 其余数值：模型偶尔带单位（如 "256ms"），只保留数值部分，单位由卡片配置补
function formatMetricValue(v) {
  if (v == null || v === '') return '—';
  const s = String(v ?? '').trim();
  const m = s.match(/^-?\d+(?:\.\d+)?/);
  return m ? m[0] : s;
}

function formatDurationMinutes(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const seconds = Math.round(n * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// 生成「截图识别到的数据」卡片：只列真正识别到的项，全为空时返回空串（不出这张卡）
function buildRecogCard(recognition) {
  const m = (recognition && recognition.metrics) || {};
  const has = (k) => m[k] !== null && m[k] !== undefined && String(m[k]).trim() !== '';
  const groups = [];

  for (const g of RECOG_GROUPS) {
    const chips = g.items.filter(([k]) => has(k)).map(([k, label, unit]) => {
      const val = k.indexOf('pace') >= 0 ? formatPaceValue(m[k]) : formatMetricValue(m[k]);
      const sourceLabel = k === 'weekly_volume_km'
        ? recognition.weekly_volume_source === 'user_last_7_days' ? '近 7 天跑量（用户填报）'
          : recognition.weekly_volume_source === 'dated_week_summary' ? '截图周汇总跑量'
            : '周跑量（口径待核对）'
        : label;
      return `<div class="metric-chip"><span class="mc-label">${esc(sourceLabel)}</span><span class="mc-value">${esc(val)}${unit ? `<em>${esc(unit)}</em>` : ''}</span></div>`;
    });
    // 左右触地平衡是两个字段，合并成一个 chip（只在跑姿组，占两列防数字断行）
    if (g.title === '跑姿与体能' && has('ground_balance_left_pct') && has('ground_balance_right_pct')) {
      chips.push(`<div class="metric-chip wide"><span class="mc-label">左右触地平衡</span><span class="mc-value">${esc(formatMetricValue(m.ground_balance_left_pct))} / ${esc(formatMetricValue(m.ground_balance_right_pct))}<em>% 左/右</em></span></div>`);
    }
    if (chips.length) {
      groups.push(`<div class="metric-group"><h4>${esc(g.title)}</h4><div class="metric-chips">${chips.join('')}</div></div>`);
    }
  }

  // 跑姿照片观察（上传的是跑姿照片而非 App 截图时才有内容）
  const obs = (Array.isArray(recognition && recognition.form_observations) ? recognition.form_observations : [])
    .filter((o) => o && o.finding && String(o.finding).indexOf('未观察到') < 0);

  const activities = (Array.isArray(recognition && recognition.activities) ? recognition.activities : [])
    .filter((a) => a && a.metrics && typeof a.metrics === 'object');
  const oldRuns = !activities.length && Array.isArray(recognition && recognition.runs) ? recognition.runs : [];
  const metricLabels = new Map(RECOG_GROUPS.flatMap((g) => g.items.map(([key, label, unit]) => [key, [label, unit]])));
  const activitiesHtml = activities.length
    ? `<div class="metric-group"><h4>按日期归并的跑步（${activities.length} 次）</h4>
      ${activities.map((a) => {
        const am = a.metrics || {};
        const heading = [a.date || '日期未识别', am.distance_km != null ? `${formatMetricValue(am.distance_km)} km` : '距离未识别'];
        const source = Array.isArray(a.source_image_indices) && a.source_image_indices.length
          ? `来自第 ${a.source_image_indices.join('、')} 张图片` : '图片来源未标明';
        const chips = [...metricLabels.entries()].filter(([key]) => am[key] != null).map(([key, [label, unit]]) => {
          const val = key.includes('pace') ? formatPaceValue(am[key]) : formatMetricValue(am[key]);
          return `<div class="metric-chip"><span class="mc-label">${esc(label)}</span><span class="mc-value">${esc(val)}${unit ? `<em>${esc(unit)}</em>` : ''}</span></div>`;
        }).join('');
        const splits = Array.isArray(a.splits) ? a.splits : [];
        const splitRows = splits.map((s) => `<tr><td>${esc(s.segment)}</td><td>${esc(formatMetricValue(s.distance_km))}</td><td>${esc(formatDurationMinutes(s.duration_min))}</td><td>${s.avg_pace_min_per_km == null ? '—' : esc(formatPaceValue(s.avg_pace_min_per_km))}</td><td>${s.avg_heart_rate == null ? '—' : esc(formatMetricValue(s.avg_heart_rate))}</td><td>${s.cadence_spm == null ? '—' : esc(formatMetricValue(s.cadence_spm))}</td></tr>`).join('');
        const splitHtml = splitRows ? `<div class="split-scroll"><table class="split-table"><thead><tr><th>分段</th><th>公里</th><th>用时</th><th>配速</th><th>心率</th><th>步频</th></tr></thead><tbody>${splitRows}</tbody></table></div>` : '';
        return `<details class="activity-detail"><summary>${esc(heading.join(' · '))}</summary><p class="issue-evidence">${esc(source)}</p><div class="metric-chips">${chips}</div>${splitHtml}</details>`;
      }).join('')}
    </div>`
    : oldRuns.length > 1
      ? `<div class="metric-group"><h4>识别到的跑步摘要</h4>${oldRuns.map((r) => `<p class="issue-evidence">${esc(r.date || '日期未识别')} · ${esc(formatMetricValue(r.distance_km))} km</p>`).join('')}</div>`
      : '';
  const summaries = (Array.isArray(recognition && recognition.period_summaries) ? recognition.period_summaries : []);
  const summariesHtml = summaries.length
    ? `<div class="metric-group"><h4>周／月汇总（不计作单次跑步）</h4>${summaries.map((p) => `<p class="issue-evidence">${esc(p.period_start || '')} 至 ${esc(p.period_end || '')} · ${p.period_type === 'month' ? '月' : '周'}跑量 ${esc(formatMetricValue(p.distance_km))} km${p.run_count != null ? ` · ${esc(p.run_count)} 次` : ''}${p.duration_hours != null ? ` · ${esc(formatMetricValue(p.duration_hours))} 小时` : ''}${p.total_calories_kcal != null ? ` · ${esc(formatMetricValue(p.total_calories_kcal))} 千卡` : ''}</p>`).join('')}</div>`
    : '';
  const warnings = Array.isArray(recognition && recognition.data_warnings) ? recognition.data_warnings : [];
  const warningsHtml = warnings.length ? `<div class="metric-group"><h4>需要核对</h4>${warnings.map((w) => `<p class="issue-evidence">${esc(w)}</p>`).join('')}</div>` : '';
  const supplied = recognition && recognition.user_provided && typeof recognition.user_provided === 'object' ? recognition.user_provided : {};
  const suppliedFields = [
    ['age', '年龄', '岁'], ['height_cm', '身高', 'cm'], ['weight_kg', '体重', 'kg'],
    ['run_years', '跑龄', ''], ['weekly_volume_km', '近 7 天跑量', 'km'],
    ['avg_pace', '典型配速', ''], ['avg_heart_rate', '典型心率', 'bpm'], ['cadence_spm', '步频', 'spm'],
  ];
  const suppliedChips = suppliedFields.filter(([key]) => supplied[key] != null && supplied[key] !== '')
    .map(([key, label, unit]) => `<div class="metric-chip"><span class="mc-label">${esc(label)}</span><span class="mc-value">${esc(supplied[key])}${unit ? `<em>${esc(unit)}</em>` : ''}</span></div>`).join('');
  const suppliedHtml = suppliedChips ? `<div class="metric-group"><h4>用户补充（未经图片核实）</h4><div class="metric-chips">${suppliedChips}</div></div>` : '';

  if (!groups.length && !obs.length && !activitiesHtml && !summariesHtml && !suppliedHtml) return '';

  return `<div class="report-card wide" id="card-metrics">
    <h3>截图识别到的数据</h3>
    <p class="issue-evidence">顶部单次指标对应识别到的最新一次跑步，周跑量另标来源；下面按活动和汇总分开列出。AI 识别可能有误，请对照原图核对。</p>
    ${groups.join('')}
    ${activitiesHtml}
    ${summariesHtml}
    ${warningsHtml}
    ${suppliedHtml}
    ${obs.length ? `<div class="metric-group"><h4>跑姿照片观察</h4>
      ${obs.map((o) => `<p class="issue-evidence"><strong>${esc(o.part || '')}</strong>：${esc(o.finding)}${o.confidence ? `（把握度 ${esc(o.confidence)}）` : ''}</p>`).join('')}
    </div>` : ''}
  </div>`;
}

// 8 周计划的"当前周"：课表按周一至周日排列，第 1 周对齐诊断日所在的那个自然周——
// 诊断日当天及之后的课正常执行，诊断日之前已过去的课不用补做，第 2 周起从下一个周一开始。
// 过了几整周就是第几周（封顶计划周数）。每次新诊断都会重新生成整份计划并重新锚定，
// 所以只需对最新报告计算进行中周数；旧报告传 endAt（被下一条诊断取代的时间），
// 算出的是"当时进行到了第几周"。
function planWeekInfo(createdAt, planLen, endAt) {
  const len = planLen || 8;
  if (!createdAt) return { week: 1, idx: 0, finished: false, days: 0 };
  const created = new Date(createdAt);
  const anchor = new Date(created.getFullYear(), created.getMonth(), created.getDate() - (created.getDay() + 6) % 7);
  const end = endAt ? new Date(endAt).getTime() : Date.now();
  const days = Math.max(0, Math.floor((end - anchor.getTime()) / 86400000));
  const week = Math.floor(days / 7) + 1;
  if (week > len) return { week: len, idx: len - 1, finished: true, days };
  return { week: Math.max(1, week), idx: Math.max(0, week - 1), finished: false, days };
}

function renderReport(payload) {
  const d = payload.diagnosis_result || payload;
  const recognition = payload.recognition || null;
  const body = $('#reportBody');
  const banner = $('#riskBanner');
  const nav = $('#reportNav');
  const actions = $('#reportActions');

  // 层层兜底：没有 diagnosis_result 就把整个 payload 当诊断对象（兼容直接传诊断对象的旧调用）。
  // 走到这里说明报告内容不是可渲染的对象（AI 返回的文本没能解析成 JSON），
  // 或 diagnosis 为 null 时的外壳对象（历史脏数据）——一并按"内容不完整"处理，
  // 不能让外壳对象漏过去渲染成一份 summary 为"—"的伪报告。
  // 正常路径下后端已拦掉这类结果，这里只兜历史遗留记录与异常展示，不再提具体平台名。
  const hasContent = d && typeof d === 'object' && !Array.isArray(d)
    && (typeof d.summary === 'string' || Array.isArray(d.plan_8_weeks) || Array.isArray(d.training_plan) || Array.isArray(d.diagnosis) || typeof d.risk_alert === 'string');
  if (!hasContent) {
    body.innerHTML = `<div class="report-card wide">
      <h3>这份报告的内容不完整</h3>
      <p>AI 返回的结果没能被正确解析（可能是生成中途被截断）。建议回到诊断页重新提交一次；重新提交不额外扣费。</p>
      <p class="issue-evidence">这次记录已保存在历史里，可以删除后重试。若反复出现，麻烦在「意见反馈」里告知我们。</p>
    </div>`;
    banner.classList.add('hidden');
    nav.classList.add('hidden');
    actions.classList.add('hidden');
    return;
  }

  // 字段别名兜底：plan_8_weeks 可能被命名成 training_plan
  const plan = Array.isArray(d.plan_8_weeks) ? d.plan_8_weeks : (Array.isArray(d.training_plan) ? d.training_plan : []);
  const progress = d.progress || null;
  const issues = Array.isArray(d.diagnosis) ? d.diagnosis : [];
  const goalFz = d.goal_feasibility || null;
  const hasProgress = progress && (progress.improved || progress.regressed || progress.prev_plan_completion);

  // 红线通栏
  if (d.risk_alert) {
    banner.classList.remove('hidden');
    banner.innerHTML = `<span class="rb-icon">⚠️</span><span><strong>健康提醒：</strong>${esc(d.risk_alert)}</span>`;
  } else {
    banner.classList.add('hidden');
  }

  const html = [];

  // 图片识别受限：给特殊提示，而不是渲染一堆 null 指标
  if (recognition && (recognition.image_type === 'unclear' || recognition.image_error)) {
    html.push(`<div class="report-card wide warn-card" id="card-image">
      <h3>📷 图片识别受限</h3>
      <p>${esc(recognition.image_error || '上传的图片未能识别出跑步相关内容')}</p>
      <p class="issue-evidence">本次报告仅基于您的文字描述生成。建议重新上传清晰的跑步 App 截图或跑姿照片，以获得更准确的诊断与计划。</p>
    </div>`);
  }

  html.push(`<div class="report-card" id="card-summary">
    <h3>一句话总评</h3>
    <p class="report-summary">${esc(d.summary || '—')}</p>
  </div>`);

  // 识别到的原始指标：诊断结论的依据来源，放在总评后让用户先核对数据
  html.push(buildRecogCard(recognition));

  if (hasProgress) {
    // 旧记录的 improved/regressed 可能是字符串等非数组（历史脏数据），归一成数组再渲染，防 .filter 崩溃白板
    const improved = (Array.isArray(progress.improved) ? progress.improved : []).filter(Boolean);
    const regressed = (Array.isArray(progress.regressed) ? progress.regressed : []).filter(Boolean);
    // 兼容两种输出形态：prev_plan_completion/adjustment 可能在 progress 内或顶层
    const ppc = progress.prev_plan_completion || d.prev_plan_completion || null;
    const adj = progress.adjustment || d.adjustment || null;
    // 空内容给说明文案，不用"—"占位
    const improvedHtml = improved.length
      ? improved.map((i) => `<li>${esc(i)}</li>`).join('')
      : '<li class="progress-empty">暂无可对比的改善数据，下次诊断自动生成</li>';
    const regressedHtml = regressed.length
      ? regressed.map((i) => `<li>${esc(i)}</li>`).join('')
      : '<li class="progress-empty">本次没有需要特别注意的变化，继续保持</li>';
    html.push(`<div class="report-card" id="card-progress">
      <h3>相比上次的对比</h3>
      <div class="progress-grid">
        <div class="progress-col improved"><h4>改善的</h4><ul>${improvedHtml}</ul></div>
        <div class="progress-col regressed"><h4>需注意</h4><ul>${regressedHtml}</ul></div>
      </div>
      ${ppc ? `<p class="progress-note"><strong>上一轮计划完成度：</strong>${esc(ppc)}</p>` : ''}
      ${adj ? `<p class="progress-note"><strong>调整思路：</strong>${esc(adj)}</p>` : ''}
    </div>`);
  } else {
    // 首次诊断的友好空状态
    html.push(`<div class="report-card empty-state" id="card-progress">
      <h3>相比上次的对比</h3>
      <p>这是您的首次诊断，还没有可对比的历史数据。下次上传最新跑步数据后，我们会自动生成进度对比，告诉您哪些指标改善了、哪些需要注意。</p>
    </div>`);
  }

  if (issues.length) {
    html.push(`<div class="report-card" id="card-issues">
      <h3>问题诊断（${issues.length} 项）</h3>
      ${issues.map((item) => `
        <div class="issue-item">
          <div class="issue-head"><h4>${esc(item.issue)}</h4>
            <span class="risk-tag risk-${esc(item.risk)}">${RISK_ICON[item.risk] || ''} ${esc(item.risk) || '未知'}风险</span>
          </div>
          <p class="issue-evidence">依据：${esc(item.evidence) || '未提供依据'}</p>
          ${item.advice ? `<p class="issue-advice">${esc(item.advice)}</p>` : ''}
        </div>`).join('')}
    </div>`);
  }

  if (goalFz) {
    const concerns = Array.isArray(goalFz.concerns) ? goalFz.concerns.filter(Boolean).join('；') : (goalFz.concerns || '');
    html.push(`<div class="report-card" id="card-goal">
      <h3>目标评估</h3>
      <p style="font-size:14px;margin-bottom:8px">${esc(goalFz.assessment || '—')}</p>
      ${concerns ? `<p class="issue-evidence">风险点：${esc(concerns)}</p>` : ''}
      ${goalFz.milestone ? `<p class="issue-advice">关键里程碑：${esc(goalFz.milestone)}</p>` : ''}
      ${d.race_day_strategy ? `<p class="issue-advice" style="margin-top:8px">比赛日策略：${esc(d.race_day_strategy)}</p>` : ''}
    </div>`);
  }

  // 趋势图占位（≥2 个数据点时才填充）
  html.push(`<div class="report-card wide hidden" id="trendWrap">
    <h3>数据趋势</h3>
    <p class="issue-evidence" style="margin-bottom:8px">按报告提交顺序展示，横轴优先标注运动数据日期。实际周跑量来自用户填写的近 7 天数据或截图中的周汇总，与新计划第 1 周目标分开；未知值不补写。</p>
    <div id="trendChart" style="width:100%;height:240px"></div>
  </div>`);

  if (plan.length) {
    // 最新报告：按记录生成日定位"当前第 N 周"并高亮展开；
    // 旧报告的计划已被新诊断取代，显示"当时已进行至第 N 周"（按被取代时间计算），仅作历史参考
    const meta = payload.meta || {};
    const isLatest = meta.is_latest !== false;
    const cw = planWeekInfo(meta.created_at, plan.length, isLatest ? null : meta.superseded_at);
    const openIdx = Math.min(cw.idx, plan.length - 1);
    let badgeHtml = '';
    if (!isLatest) {
      badgeHtml = `<span class="plan-now old" title="该计划已被更新的诊断取代，仅作历史参考">已进行至第 ${cw.week} 周</span>`;
    } else if (cw.finished) {
      badgeHtml = `<span class="plan-now done">已满 ${plan.length} 周 · 建议重新诊断</span>`;
    } else {
      badgeHtml = `<span class="plan-now">第 ${cw.week} 周进行中</span>`;
    }
    const isCur = isLatest && !cw.finished;
    // 第 1 周按诊断日所在的自然周执行：诊断日是周中时提示已过去的课不用补
    const diagDow = meta.created_at ? new Date(meta.created_at).getDay() : 1;
    const alignNote = isLatest && cw.week === 1 && diagDow !== 1
      ? `<p class="issue-evidence" style="margin:2px 0 8px">本周课表从诊断日当天的周几开始执行：诊断日之前已过去的课（如周一）不用补做，从今天起按周几跟上即可。</p>`
      : '';
    html.push(`<div class="report-card wide" id="card-plan">
      <div class="card-head-row">
        <h3>未来 ${plan.length} 周训练计划 ${badgeHtml}</h3>
        <button class="btn-ghost btn-sm" id="expandAllWeeks">展开全部</button>
      </div>
      ${alignNote}
      <div class="timeline">
        ${plan.map((w, idx) => {
          const weekNo = esc(w.week || idx + 1);
          const cur = isCur && idx === cw.idx;
          return `<div class="tl-item${idx === openIdx ? ' open' : ''}${cur ? ' cur' : ''}" data-idx="${idx}">
            <div class="tl-rail"><span class="tl-dot${cur ? ' cur' : ''}">${weekNo}</span></div>
            <div class="tl-content">
              <div class="week-head"><strong>第 ${weekNo} 周 · ${esc(w.focus || '—')}${cur ? '<em class="wk-now">本周</em>' : ''}</strong><span>周跑量 ${esc(w.weekly_volume_km ?? '—')} km · 点击展开</span></div>
              <div class="week-body">
                ${(Array.isArray(w.runs) ? w.runs : []).map((r) => `
                  <div class="run-item"><span class="run-day">${esc(r.day)}</span><span class="run-type">${esc(r.type)}</span><span>${esc(r.detail)}</span></div>`).join('') || '<p class="issue-evidence">本周无具体安排</p>'}
                ${w.note ? `<div class="week-note">${esc(w.note)}</div>` : ''}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`);
  }

  // 复诊建议：不固定周数。每份计划按生成日重新锚定，若固定"第 N 周复诊"，
  // 计划永远只执行到第 N 周就被新计划取代。唯一硬性要求是 8 周全部走完后必须复诊
  html.push(`<div class="next-check">
    <strong>何时再来复诊？</strong>
    <p>不用卡固定周数：计划执行顺利时，建议在<b>下一个加量阶段或强度课开始前</b>上传新数据复诊；出现疼痛、持续疲劳、体重或生活节奏明显变化时，<b>随时上传重新诊断</b>，报告会以当天为起点重新生成计划。</p>
    <p>8 周计划全部结束后，<b>请务必上传新数据复诊</b>，生成下一轮计划继续训练。</p>
  </div>`);

  body.innerHTML = html.join('');
  actions.classList.remove('hidden');
  wireReportExtras(nav, plan.length);
  loadTrends();
}

// 锚点导航 + 展开全部 + 导出按钮
function wireReportExtras(nav, planCount) {
  const sections = [];
  const has = (id) => document.getElementById(id);
  if (has('card-summary')) sections.push(['总评', 'card-summary']);
  if (has('card-progress')) sections.push(['进度对比', 'card-progress']);
  if (has('card-issues')) sections.push(['问题诊断', 'card-issues']);
  if (has('card-goal')) sections.push(['目标评估', 'card-goal']);
  if (has('card-plan')) sections.push(['训练计划', 'card-plan']);

  if (sections.length > 1) {
    nav.classList.remove('hidden');
    nav.innerHTML = sections.map(([t, id]) => `<a href="#" data-scroll="${id}">${t}</a>`).join('');
  } else {
    nav.classList.add('hidden');
  }

  if (planCount > 1) {
    const btn = $('#expandAllWeeks');
    btn.classList.remove('hidden');
    btn.onclick = () => {
      const items = $$('#card-plan .tl-item');
      const allOpen = [...items].every((it) => it.classList.contains('open'));
      items.forEach((it) => it.classList.toggle('open', !allOpen));
      btn.textContent = allOpen ? '展开全部' : '收起全部';
    };
  }
}

// 报告内交互：折叠周计划、锚点滚动、导出
$('#reportBody').addEventListener('click', (e) => {
  const head = e.target.closest('.week-head');
  if (head) {
    head.closest('.tl-item').classList.toggle('open');
    return;
  }
});

$('#reportNav').addEventListener('click', (e) => {
  const link = e.target.closest('[data-scroll]');
  if (!link) return;
  e.preventDefault();
  const el = document.getElementById(link.dataset.scroll);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#btnExportImage').addEventListener('click', exportImage);
$('#btnExportPdf').addEventListener('click', exportPdf);

// CDN 按需加载，不阻塞首屏；按 src 去重：报告页反复打开时不重复注入/执行同一份大脚本
const loadedScripts = {};
function loadScript(src) {
  if (!loadedScripts[src]) {
    loadedScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete loadedScripts[src]; reject(new Error('组件加载失败，请检查网络后重试')); };
      document.head.appendChild(s);
    });
  }
  return loadedScripts[src];
}

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
// 微信内置浏览器（XWeb/X5 内核）对 Web Share 没有可靠实现：canShare 可能为真但调起后
// 永不返回（页面卡死在"导出中"），失败后落到的 a.download blob 链接又会被微信拦截、
// 跳到外部浏览器打开一个空白 blob: 页面，文件也不落地（用户实测反馈）。
// 因此微信环境一律跳过 share 和 blob 下载，直接走页内长图预览兜底。
const isWeChat = /MicroMessenger/i.test(navigator.userAgent);

// 生成报告水印页脚的二维码（dataURL），指向产品页面本身
// 用 window.location.origin：本地是 localhost，部署后自动是线上域名，无需硬编码
async function makeWatermarkQR() {
  await loadScript('./vendor/qrcode.min.js');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(holder);
  try {
    new QRCode(holder, {
      text: window.location.origin,
      width: 140,
      height: 140,
      correctLevel: QRCode.CorrectLevel.M,
    });
    const cv = holder.querySelector('canvas');
    const img = holder.querySelector('img');
    if (cv) return cv.toDataURL('image/png');
    if (img && img.src) return img.src;
    return null;
  } finally {
    holder.remove();
  }
}

// 检测静态图片是否存在（公众号/视频号二维码放在 public/ 根目录）
async function imgExists(name) {
  try {
    const r = await fetch(name, { method: 'HEAD', cache: 'no-cache' });
    return r.ok;
  } catch (e) {
    return false;
  }
}

// 三码水印页脚：左公众号 / 中程序码（主推）/ 右视频号
// 视频号用裁好的方形图（qrcode-sph-square.jpg）：原图是竖版卡片，塞进 74px 的方形位
// 会被压扁成一个"方疙瘩"，和另外两个方码明显不齐。
async function buildWatermarkFooter() {
  const [qr, gzhOk, sphOk] = await Promise.all([
    makeWatermarkQR().catch(() => null),
    imgExists('./qrcode-gzh.jpg'),
    imgExists('./qrcode-sph-square.jpg'),
  ]);
  if (!qr && !gzhOk && !sphOk) return null;

  const side = (src, label) =>
    `<div class="wm-side"><img class="wm-qr-side" src="${src}" alt="${label}"><span>${label}</span></div>`;

  const footer = document.createElement('div');
  footer.className = 'report-watermark wm-tri';
  footer.innerHTML = `
    <div class="wm-text">
      <strong>跑悟 · AI 跑步诊断</strong>
      <span class="wm-sub">扫码生成你的专属跑步报告 · 跑得对，比跑得多更重要</span>
    </div>
    <div class="wm-codes">
      ${gzhOk ? side('qrcode-gzh.jpg', '公众号') : '<div class="wm-side"></div>'}
      ${qr ? `<div class="wm-main"><img class="wm-qr" src="${qr}" alt="扫码体验"><span>小程序</span></div>` : '<div class="wm-side"></div>'}
      ${sphOk ? side('qrcode-sph-square.jpg', '视频号') : '<div class="wm-side"></div>'}
    </div>
  `;
  return footer;
}

async function captureReport(label) {
  showToast(label || '正在生成报告快照…');
  await loadScript('./vendor/html2canvas.min.js');
  const el = $('#reportBody');

  // 导出前展开全部周计划：长图/PDF 必须包含 1-8 周完整内容，不能只截到当前展开的那一周
  const planItems = $$('#reportBody .tl-item');
  const wasOpen = [...planItems].map((it) => it.classList.contains('open'));
  planItems.forEach((it) => it.classList.add('open'));

  // html2canvas 不认 <details> 的折叠语义：收起状态的 details 内容会被当成可见元素
  // 直接画到 summary 上，导出长图/PDF 出现内容重叠（重码）。导出前全部展开，导出后还原
  const detailsEls = $$('#reportBody details');
  const detailsWasOpen = [...detailsEls].map((d) => d.open);
  detailsEls.forEach((d) => { d.open = true; });

  // 临时插入水印页脚：渲染进长图后立即移除，不影响页面本身
  let footer = null;
  try {
    footer = await buildWatermarkFooter();
    if (footer) el.appendChild(footer);
  } catch (e) {
    // 二维码失败不挡导出，最多没水印
  }

  // 超长报告限制画布总高度，避免 Canvas/jsPDF 超限导致导出的图片或 PDF 打不开。
  // 原写法 Math.max(1, …) 让缩放永远 ≥ 1，这道闸门等于没装：报告一旦超过 14000px，
  // 画布就被撑到超限，导出的图片/PDF 直接打不开。改为真正允许降到 1 以下，下限 0.5 防糊。
  const maxCanvasH = 14000;
  const scale = Math.max(0.5, Math.min(2, maxCanvasH / Math.max(el.offsetHeight, 1)));
  try {
    return await html2canvas(el, {
      scale,
      backgroundColor: '#F6F8F7',
      useCORS: true,
    });
  } finally {
    if (footer && footer.parentNode) footer.remove();
    // 恢复用户原来的折叠状态，并同步"展开全部"按钮文案
    planItems.forEach((it, i) => it.classList.toggle('open', wasOpen[i]));
    const expandBtn = $('#expandAllWeeks');
    if (expandBtn) expandBtn.textContent = wasOpen.every(Boolean) ? '收起全部' : '展开全部';
    // 还原 details 的折叠状态
    detailsEls.forEach((d, i) => { d.open = detailsWasOpen[i]; });
  }
}

// 导出按钮 loading：大报告截取需数秒，避免用户以为没反应而连点
async function withExportBusy(fn) {
  const btns = [$('#btnExportImage'), $('#btnExportPdf')];
  const originals = btns.map((b) => b.textContent);
  btns.forEach((b) => { b.disabled = true; });
  try {
    await fn();
  } finally {
    btns.forEach((b, i) => { b.disabled = false; b.textContent = originals[i]; });
  }
}

async function exportImage() {
  try {
    await withExportBusy(async () => {
      $('#btnExportImage').textContent = '生成中…';
      const canvas = await captureReport();
      const dataURL = canvas.toDataURL('image/png');
      if (isMobile) {
        // 移动端 <a download> 不会存进相册：优先调起系统分享（可直接存相册或转发朋友圈）
        // toBlob 包成 Promise 并 await：忙碌态要等分享/预览真的弹出才结束，防止立刻点"导出 PDF"触发二次截图
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const file = blob ? new File([blob], '跑悟AI跑步报告.png', { type: 'image/png' }) : null;
        // 微信里不试 share（webview 内无可靠实现，见 isWeChat 处说明），直接长按保存
        if (file && !isWeChat && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: '我的 AI 跑步报告' });
            showToast('已保存或分享');
            return;
          } catch (e) {
            if (e.name === 'AbortError') return; // 用户主动取消，不算失败
          }
        }
        // 兜底：全屏预览，长按图片保存到相册
        $('#shareImage').src = dataURL;
        $('#shareOverlay').classList.remove('hidden');
        showToast('长按图片即可保存到相册');
        return;
      }
      const a = document.createElement('a');
      a.download = '跑悟AI跑步报告.png';
      a.href = dataURL;
      a.click();
      showToast('长图已生成');
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

async function exportPdf() {
  try {
    await withExportBusy(async () => {
      $('#btnExportPdf').textContent = '导出中…';
      const canvas = await captureReport('正在导出 PDF…');
      await loadScript('./vendor/jspdf.umd.min.js');
      const { jsPDF } = window.jspdf;
      const img = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pw) / canvas.width;
      // 长报告按 A4 宽度分页拼接，而不是把整张长图塞进一页
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(img, 'JPEG', 0, position, pw, imgH);
      heightLeft -= ph;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, position, pw, imgH);
        heightLeft -= ph;
      }
      if (isMobile) {
        const blob = pdf.output('blob');
        if (isWeChat) {
          // 微信 webview 存不了 blob 也靠不住 share，但能打开"真实 HTTP 地址的 PDF"：
          // 把 PDF 送到自家服务端换个短时 URL，微信自带文件预览器会打开，
          // 右上角菜单里可以保存 / 用其他应用打开 —— 这是在微信里拿到 PDF 文件的唯一可靠路径。
          try {
            const fd = new FormData();
            fd.append('file', new File([blob], '跑悟AI跑步报告.pdf', { type: 'application/pdf' }));
            const { url } = await request('/export/pdf', { body: fd, isForm: true });
            // 优先新窗口（保住当前页面）；弹窗被拦时同窗跳转——顶层导航不受弹窗拦截影响
            const w = window.open(url, '_blank');
            if (!w) location.href = url;
            showToast('已打开 PDF，可在右上角「…」菜单里保存或用其他应用打开');
            return;
          } catch (e) {
            // 上传失败（服务端未重启/网络断）→ 退回长图预览，保证用户至少拿得到内容
            $('#shareImage').src = canvas.toDataURL('image/png');
            $('#shareOverlay').classList.remove('hidden');
            showToast('PDF 传送失败，已生成长图，长按图片即可保存');
            return;
          }
        }
        // ① 优先系统分享（可直接转发或存到文件 App）；② 不支持分享就直接触发下载链接
        const file = new File([blob], '跑悟AI跑步报告.pdf', { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: '我的 AI 跑步报告' });
            showToast('PDF 已分享或保存');
            return;
          } catch (e) {
            if (e.name === 'AbortError') return; // 用户主动取消
            // 分享失败继续走下载兜底
          }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '跑悟AI跑步报告.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        showToast('PDF 已生成：若浏览器无下载反应，请改用「生成长图」长按图片保存');
      } else {
        pdf.save('跑悟AI跑步报告.pdf');
        showToast('PDF 已生成');
      }
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

$('#shareClose').addEventListener('click', () => $('#shareOverlay').classList.add('hidden'));

// ---------- 趋势图 ----------
async function loadTrends() {
  const wrap = $('#trendWrap');
  try {
    const { series } = await request('/trends', { method: 'GET' });
    const pts = (series || []).filter((s) => s.weekly_volume_km != null || s.planned_volume_km != null || s.avg_heart_rate != null);
    if (pts.length < 2) {
      wrap.classList.add('hidden');
      return;
    }
    await loadScript('./vendor/echarts.min.js');
    wrap.classList.remove('hidden');
    // 快速连开两份报告时，上一个 loadTrends 可能已对同一节点 init 过：先销毁避免泄漏与告警
    const prevChart = window.echarts && echarts.getInstanceByDom($('#trendChart'));
    if (prevChart) prevChart.dispose();
    const chart = echarts.init($('#trendChart'));
    const labels = pts.map((s) => {
      const d = new Date(s.activity_date || s.date);
      return `第${s.version}次 ${d.getMonth() + 1}/${d.getDate()}`;
    });
    chart.setOption({
      tooltip: { trigger: 'axis' },
      // 图例缩写在窄屏只占一行；grid.top 留足高度，避免图例、轴名和折线互相遮挡
      legend: {
        data: ['实际跑量(km)', '计划首周(km)', '平均心率'],
        top: 0,
        itemGap: 10,
        itemWidth: 18,
        textStyle: { fontSize: 11 },
      },
      grid: { left: 44, right: 44, top: 72, bottom: 30 },
      xAxis: { type: 'category', data: labels, boundaryGap: false },
      yAxis: [
        { type: 'value', name: '跑量', nameTextStyle: { fontSize: 11 }, nameGap: 10, splitLine: { lineStyle: { color: '#E5E7EB' } } },
        { type: 'value', name: '心率', nameTextStyle: { fontSize: 11 }, nameGap: 10, splitLine: { show: false } },
      ],
      series: [
        { name: '实际跑量(km)', type: 'line', smooth: true, color: '#0F6E56', data: pts.map((s) => s.weekly_volume_km) },
        { name: '计划首周(km)', type: 'line', smooth: true, lineStyle: { type: 'dashed' }, color: '#7A9C8B', data: pts.map((s) => s.planned_volume_km) },
        { name: '平均心率', type: 'line', smooth: true, yAxisIndex: 1, color: '#B7791F', data: pts.map((s) => s.avg_heart_rate) },
      ],
    });
    // ECharts writes a pixel width into its canvas; recalculate it after a
    // desktop-to-phone resize so the old canvas width cannot stretch the page.
    if (!window.__trendResizeBound) {
      window.__trendResizeBound = true;
      window.addEventListener('resize', () => {
        const node = document.getElementById('trendChart');
        const instance = node && window.echarts && echarts.getInstanceByDom(node);
        if (instance) requestAnimationFrame(() => instance.resize());
      });
    }
  } catch (err) {
    wrap.classList.add('hidden');
  }
}

// ---------- 历史记录（分页） ----------
let historyOffset = 0;
const HISTORY_PAGE = 20;
let historyLoading = false;
let historyGen = 0; // 代际号：切换页面触发 reset 时，让还在途的"加载更多"响应作废

async function loadHistory(reset = true) {
  if (historyLoading) {
    if (!reset) return; // 在途的"加载更多"没回来前忽略重复点击，防止两批相同记录各插一遍
    historyGen += 1; // reset 优先：作废在途请求的记账
  }
  historyLoading = true;
  const gen = historyGen;
  try {
    if (reset) {
      historyOffset = 0;
      $('#historyList').innerHTML = '';
    }
    const { records, has_more } = await request(
      `/records?limit=${HISTORY_PAGE}&offset=${historyOffset}`,
      { method: 'GET' }
    );
    if (gen !== historyGen) return; // 已被新的 reset 作废
    historyOffset += records.length;

    if (!records.length && historyOffset === 0) {
      $('#historyList').innerHTML = '<p class="section-desc">还没有诊断记录，先去做一次数据诊断。</p>';
      $('#loadMoreBtn').classList.add('hidden');
      return;
    }

    $('#historyList').innerHTML += records
      .map((r) => {
        const summary = r.summary
          || (r.status === 'failed' ? '分析失败，可删除后重试'
            : r.status === 'done' ? '点击查看完整报告' : '分析进行中，请稍候');
        const statusText = { done: '已完成', failed: '分析失败', pending: '分析中' }[r.status] || esc(r.status);
        const riskTag = r.risk_level ? `<span class="risk-tag risk-${esc(r.risk_level)}">${RISK_ICON[r.risk_level] || ''} ${esc(r.risk_level)}风险</span>` : '';
        // 版本号取 max(1, …)：后端重编号的负数占位是瞬时中间态，不该显示成"第 -2 次"
        return `<div class="history-item" data-id="${esc(r.id)}">
          <div><div class="ver">第 ${Math.max(1, Number(r.version) || 1)} 次诊断 ${goalBadge(r.goal)} ${riskTag}</div>
          <div class="meta">${new Date(r.created_at).toLocaleDateString('zh-CN')} · ${esc(summary)}</div></div>
          <div class="history-actions">
            <span class="status-${esc(r.status)}">${statusText}</span>
            <button class="btn-del" data-del="${esc(r.id)}" title="删除该记录">删除</button>
          </div>
        </div>`;
      })
      .join('');

    $('#loadMoreBtn').classList.toggle('hidden', !has_more);
  } catch (err) {
    if (gen === historyGen) showToast(err.message, true);
  } finally {
    historyLoading = false;
  }
}

$('#loadMoreBtn').addEventListener('click', () => loadHistory(false));

$('#historyList').addEventListener('click', async (e) => {
  // 删除按钮：单独处理，不触发查看
  const delBtn = e.target.closest('[data-del]');
  if (delBtn) {
    const id = delBtn.dataset.del;
    const item = delBtn.closest('.history-item');
    // 用自定义弹窗，不用原生 confirm：连续调用会被浏览器节流甚至变成"关闭网页"对话框
    const ok = await confirmDialog('确认删除这条诊断记录？删除后不可恢复，报告和历史对比都会少这一条。', { title: '删除记录' });
    if (!ok) return;
    delBtn.disabled = true;
    delBtn.textContent = '删除中…';
    try {
      await request('/records/' + id, { method: 'DELETE' });
      if (item) item.remove();
      historyOffset = Math.max(0, historyOffset - 1);
      // 删的是列表最后一条时，提示清空态
      if (!$('#historyList').children.length) {
        $('#historyList').innerHTML = '<p class="section-desc">还没有诊断记录，先去做一次数据诊断。</p>';
        $('#loadMoreBtn').classList.add('hidden');
      }
      showToast('记录已删除');
      // 首页统计可能变化，静默刷新
      loadHome();
    } catch (err) {
      showToast(err.message, true);
      delBtn.disabled = false;
      delBtn.textContent = '删除';
    }
    return;
  }

  const item = e.target.closest('.history-item');
  if (!item) return;
  openRecord(item.dataset.id);
});

// 退出页的"重新进入"：整页重来一遍，回到登录态首页
$('#btnReenter').addEventListener('click', () => location.reload());

// ---------- 启动 ----------
// 有缓存令牌就立刻武装返回守卫，不等 /auth/me 回来：
// 免密进入时首屏那一两秒里用户已经在用，那时滑动边缘同样不能被直接掉出程序
if (state.token) armBackGuard();

(async function bootstrap() {
  if (!state.token) return show('auth');
  try {
    const { user } = await request('/auth/me', { method: 'GET' });
    setLogged(user);
    show('home');
    loadHome();
  } catch (e) {
    // 401 时 request() 内部已 logout 并清 token；网络抖动/超时/服务端 5xx 不能误杀有效登录态——
    // 保留 token 停在登录页，网络恢复后刷新即可自动进入（地铁/电梯场景常见）
    if (!state.token) return show('auth'); // 已被 401 登出
    show('auth');
    showToast('网络不佳，暂无法确认登录状态；恢复网络后刷新页面可自动登录', true);
  }
})();
