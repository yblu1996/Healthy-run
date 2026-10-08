// 账号与数据改动的真机渲染 + 真实点击核对：
//   ① 首页「账号与数据」区块（桌面 / 手机）布局是否协调、文案有没有溢出
//   ② 注销弹窗（风险提示 + 两个输入框）排版
//   ③ 点「导出」是否真的下载到文件，内容对不对
//   ④ 走完整个注销三确认流程，账号是否真的被删掉
//
// 用一次性的测试账号（脚本自己注册），不碰任何真实用户数据；
// 流程跑完这个账号也就没了，不需要额外清理。
//
// 用法（先起临时实例，别动正在跑的 3000）：
//   PORT=3010 node api/index.js
//   NODE_PATH=<托管 node workspace> node dev-tests/.shot-account.js
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3010';
const OUT = (f) => path.join(__dirname, '.ui-shots', f);

async function api(p, { method = 'POST', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

let pass = 0;
let fail = 0;
function ck(name, ok, extra) {
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name}${extra ? '   ' + extra : ''}`);
  if (ok) pass += 1; else fail += 1;
}

const measureHome = (p) => p.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); };
  const card = document.querySelector('.acct-card');
  const rows = [...document.querySelectorAll('.acct-row')];
  return {
    卡片尺寸: box(card),
    行数: rows.length,
    行高: rows.map((r) => Math.round(r.getBoundingClientRect().height)).join('/'),
    导出按钮可见: (() => { const b = document.querySelector('#btnExportData'); return !!b && b.offsetParent !== null && b.getBoundingClientRect().width > 0; })(),
    注销按钮可见: (() => { const b = document.querySelector('#btnDeleteAccount'); return !!b && b.offsetParent !== null && b.getBoundingClientRect().width > 0; })(),
    文案: card ? card.innerText.replace(/\s+/g, ' ').trim() : null,
    横向溢出: document.documentElement.scrollWidth > window.innerWidth,
  };
});

const measureModal = (p) => p.evaluate(() => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); };
  const m = document.querySelector('#deleteAccountModal');
  return {
    可见: !m.classList.contains('hidden'),
    卡片尺寸: box(m.querySelector('.modal-card')),
    风险提示尺寸: box(m.querySelector('.danger-note')),
    密码框存在: !!m.querySelector('#delPassword'),
    确认词框存在: !!m.querySelector('#delConfirmWord'),
    提交按钮文案: m.querySelector('#delAccountSubmit').textContent,
    横向溢出: document.documentElement.scrollWidth > window.innerWidth,
  };
});

(async () => {
  // ---------- 造一个一次性账号 ----------
  const phone = '1' + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  const password = 'Test1234';
  const reg = await api('/api/auth/register', {
    body: {
      phone, password, nickname: '界面核对',
      security_question: '我的小学叫什么名字', security_answer: '核对小学',
    },
  });
  if (reg.status !== 200) throw new Error('测试账号注册失败: ' + JSON.stringify(reg.data));
  const token = reg.data.token;
  console.log(`目标实例: ${BASE}\n测试账号: ${phone}\n`);

  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const c = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await c.addInitScript((t) => { try { localStorage.setItem('token', t); } catch (e) {} }, token);
  const p = await c.newPage();
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(2200);

  // ---------- ① 首页「账号与数据」区块 ----------
  for (const [tag, w, h] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(() => window.show('home'));
    await p.waitForTimeout(400);
    await p.evaluate(() => document.querySelector('.acct-card').scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(300);
    const m = await measureHome(p);
    console.log('[账号与数据]', tag, JSON.stringify(m));
    ck(`(${tag}) 区块两行、无横向溢出、两按钮可见`,
      m.行数 === 2 && !m.横向溢出 && m.导出按钮可见 && m.注销按钮可见, m.卡片尺寸);
    await p.screenshot({ path: OUT('account-card-' + tag + '.png') });

    // ---------- ② 注销弹窗 ----------
    await p.evaluate(() => document.querySelector('#btnDeleteAccount').click());
    await p.waitForTimeout(400);
    const mm = await measureModal(p);
    console.log('[注销弹窗]', tag, JSON.stringify(mm));
    ck(`(${tag}) 注销弹窗正常打开且含两个输入框`,
      mm.可见 && mm.密码框存在 && mm.确认词框存在 && !mm.横向溢出, mm.卡片尺寸);
    await p.screenshot({ path: OUT('account-delete-modal-' + tag + '.png') });
    await p.evaluate(() => document.querySelector('#delAccountCancel').click());
    await p.waitForTimeout(250);
  }

  // ---------- ③ 真实点击「导出」，校验下载到的文件 ----------
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.evaluate(() => window.show('home'));
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('.acct-card').scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(300);
  // 用 p.click 而不是 evaluate 里调 click：前者带真实用户手势，与真人操作一致
  const [dl] = await Promise.all([
    p.waitForEvent('download', { timeout: 20000 }),
    p.click('#btnExportData'),
  ]);
  const saved = path.join(__dirname, '.export-out', 'account-export-verify.json');
  fs.mkdirSync(path.dirname(saved), { recursive: true });
  await dl.saveAs(saved);
  const raw = fs.readFileSync(saved, 'utf8');
  const json = JSON.parse(raw);
  ck('点「导出」真的下载到文件', dl.suggestedFilename().endsWith('.json'), dl.suggestedFilename());
  ck('导出文件结构正确', !!json.account && Array.isArray(json.diagnosis_records) && !!json.exported_at);
  ck('导出文件是本人数据', json.account.phone === phone, json.account.phone);
  ck('导出文件不含哈希', !raw.includes('password_hash') && !raw.includes('$2a$') && !raw.includes('$2b$'));
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT('account-export-toast.png') });

  // ---------- ④ 走完整注销流程 ----------
  await p.evaluate(() => document.querySelector('#btnDeleteAccount').click());
  await p.waitForTimeout(300);

  // 4.1 确认词打错 → 应被拦下，弹窗不关
  await p.fill('#delPassword', password);
  await p.fill('#delConfirmWord', '删除');
  await p.evaluate(() => document.querySelector('#delAccountSubmit').click());
  await p.waitForTimeout(500);
  let toast = await p.evaluate(() => document.querySelector('#toast').textContent);
  let stillOpen = await p.evaluate(() => !document.querySelector('#deleteAccountModal').classList.contains('hidden'));
  ck('确认词打错被拦下，弹窗未关闭', stillOpen && /注销/.test(toast), 'toast=' + toast);

  // 4.2 密码打错 → 后端应返回 403，弹窗保留
  // 注意：密码是服务端校验的，而客户端在发请求前会先弹第三道确认框，
  // 所以这里必须把确认也点掉，请求才真的发出去（漏了这步就成了"测了个寂寞"）
  await p.fill('#delPassword', 'WrongPass9');
  await p.fill('#delConfirmWord', '注销');
  await p.evaluate(() => document.querySelector('#delAccountSubmit').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#confirmOk').click());
  await p.waitForTimeout(1200);
  toast = await p.evaluate(() => document.querySelector('#toast').textContent);
  const meAfterFail = await api('/api/auth/me', { method: 'GET', token });
  ck('密码打错被拒且账号未被删', /密码/.test(toast) && meAfterFail.status === 200, 'toast=' + toast + ' / me=' + meAfterFail.status);
  ck('密码打错后弹窗保留（可以重试）',
    await p.evaluate(() => !document.querySelector('#deleteAccountModal').classList.contains('hidden')));

  // 4.3 正确填写 → 第三道确认弹窗 → 点确定
  await p.fill('#delPassword', password);
  await p.fill('#delConfirmWord', '注销');
  await p.evaluate(() => document.querySelector('#delAccountSubmit').click());
  await p.waitForTimeout(500);
  const confirmShown = await p.evaluate(() => !document.querySelector('#confirmModal').classList.contains('hidden'));
  ck('出现第三道确认弹窗', confirmShown);
  await p.screenshot({ path: OUT('account-delete-confirm.png') });

  await p.evaluate(() => document.querySelector('#confirmOk').click());
  await p.waitForTimeout(2000);

  // 4.4 应已登出到登录页，且账号真的没了
  const state = await p.evaluate(() => ({
    在登录页: !!document.querySelector('#view-auth.active'),
    顶栏隐藏: getComputedStyle(document.querySelector('#topnav')).display === 'none',
    弹窗已关: document.querySelector('#deleteAccountModal').classList.contains('hidden'),
    toast: document.querySelector('#toast').textContent,
  }));
  console.log('[注销后]', JSON.stringify(state));
  ck('注销后回到登录页并隐藏顶栏', state.在登录页 && state.顶栏隐藏 && state.弹窗已关, state.toast);
  await p.screenshot({ path: OUT('account-after-delete.png') });

  const meAfter = await api('/api/auth/me', { method: 'GET', token });
  ck('账号已真正删除（接口 404）', meAfter.status === 404, 'HTTP ' + meAfter.status);
  const relogin = await api('/api/auth/login', { body: { phone, password } });
  ck('原手机号无法再登录', relogin.status >= 400, 'HTTP ' + relogin.status);

  await b.close();
  console.log(`\n通过 ${pass} / 失败 ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
