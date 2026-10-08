const express = require('express');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
require('dotenv').config();

const { supabase } = require('../lib/db');
const { signToken, verifyToken } = require('../lib/auth');
const { normalizeSubmission, normalizeRecognition, validateDiagnosis, trendPoint, buildHistoryEvidence } = require('../lib/diagnostic-contract');
// AI 工作流供应商开关：coze（默认）/ dify。两个模块同签名，切换只改这一行来源 + .env 配置
const AI_PROVIDER = (process.env.AI_PROVIDER || 'coze').toLowerCase();
const { runWorkflow } = AI_PROVIDER === 'dify' ? require('../lib/dify') : require('../lib/coze');

const app = express();
const PORT = process.env.PORT || 3000;
const BUCKET = process.env.STORAGE_BUCKET || 'run-images';
const MAX_IMAGES = 10;

// 年龄与其它填报字段在 lib/diagnostic-contract.js 统一校验。

// ---------- 图片存储：私有桶 + 签名 URL ----------
// 桶必须是私有的。公开桶生成的是永久、无鉴权的地址，谁拿到链接都能看别人的跑姿照片，
// 而跑姿照片含步态特征（属生物识别敏感信息）；实测即便从桶里删掉，公共 URL 在 CDN 缓存期内仍返回 200。
// 签名有效期 1 小时足够——预览与提交都在几分钟内完成；就算前端手里的 URL 已过期也不影响，
// 后端一律按对象路径重新签发（见 signImagePaths），不依赖客户端传来的 URL 是否新鲜。
const SIGNED_URL_TTL = Number(process.env.STORAGE_SIGNED_TTL) || 3600;
const SUPABASE_BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SIGN_PREFIX = `${SUPABASE_BASE}/storage/v1/object/sign/${BUCKET}/`;
const PUBLIC_PREFIX = `${SUPABASE_BASE}/storage/v1/object/public/${BUCKET}/`;

// 从图片地址里取出对象路径（`<user_id>/<文件名>`）。认三种形态：
// ① 现在的签名 URL  ② 历史遗留的公开 URL  ③ 裸路径（迁移后库里存的就是这种）。
// 取不出、或含路径穿越/多级嵌套的一律返回 null，由调用方拒绝。
function imageObjectPath(input) {
  if (typeof input !== 'string') return null;
  let rest = null;
  if (input.startsWith(SIGN_PREFIX)) rest = input.slice(SIGN_PREFIX.length);
  else if (input.startsWith(PUBLIC_PREFIX)) rest = input.slice(PUBLIC_PREFIX.length);
  else if (/^[\w-]+\/[\w.-]+$/.test(input)) rest = input;
  if (!rest) return null;
  rest = rest.split('?')[0].split('#')[0];
  try { rest = decodeURIComponent(rest); } catch { return null; }
  // 严格要求「目录/文件名」两段：杜绝 ../ 穿越与越权引用他人目录
  return /^[\w-]+\/[\w.-]+$/.test(rest) ? rest : null;
}

// 把对象路径签成短期可访问 URL。Dify 用 remote_url 自己拉图，签名必须现签现用。
async function signImagePaths(paths, expiresIn = SIGNED_URL_TTL) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, expiresIn);
  if (error) throw new Error('图片签名失败：' + error.message);
  // 实测批量签发按输入顺序返回，但为免得靠顺序耦合，按 path 建映射再取
  const byPath = new Map((data || []).filter((d) => d && d.signedUrl).map((d) => [d.path, d.signedUrl]));
  const out = paths.map((p, i) => byPath.get(p) || (data && data[i] && data[i].signedUrl));
  if (out.some((u) => !u)) throw new Error('图片签名失败：存在无法签发有效链接的图片');
  return out;
}

app.disable('x-powered-by');
// Railway/Nginx 反向代理场景下让 req.ip 取到真实客户端 IP（1 层代理）
app.set('trust proxy', 1);
// 上传图片走 multipart，不经过 json 解析；json 里只有图片 URL 与文字，1mb 足够
app.use(express.json({ limit: '1mb' }));
// gzip 压缩：文本资产实测 3 倍差距（app.js 108KB→37KB），移动端首屏省 0.5-1.2 秒
app.use(require('compression')());
// 静态缓存策略：vendor 库与图片一天内直接用本地缓存；html/js/css 走 no-cache
// （每次带 ETag 回源校验，命中即 304，既省流量又保证改代码后立刻生效）
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    const sep = path.sep;
    if (filePath.includes(`${sep}vendor${sep}`) || filePath.includes(`${sep}learn-media${sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// ---------- 基础安全响应头（不用 helmet 以减少依赖）----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ---------- CORS：默认同源直通；前后端分域部署时在 .env 配 ALLOWED_ORIGINS ----------
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// 图片与 PDF 分开限流：单张图片 2MB（识图用 1600px 足够，前端还会压缩，更大的纯属浪费流量），
// PDF 中转沿用 10MB。共用一个实例会让"图片 2MB"的文案套到 PDF 上（反之亦然）
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: MAX_IMAGES },
});
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ---------- async 路由包装：Express 4 不捕获 async 异常，必须显式转给错误中间件 ----------
function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------- 限流：IP 维度，1 分钟窗口（内存计数器，单实例够用）----------
// 桶键必须带路由名：只按 IP 记键的话，登录消耗的配额会挤占找回密码等其它接口的额度
const RATE_WINDOW_MS = 60 * 1000;
const rateBuckets = new Map();
function rateLimit(maxPerMinute, routeKey) {
  return (req, res, next) => {
    const ip = req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    // 手机号并入桶键：就算客户端伪造 X-Forwarded-For 轮换 IP，登录/找回等按账号的爆破也会被按手机号拦住
    const phoneKey = (req.body && typeof req.body.phone === 'string' && /^\d{11}$/.test(req.body.phone)) ? `|${req.body.phone}` : '';
    // 双桶：①ip+手机号 桶拦单账号爆破；②纯 ip 桶拦"同 IP 换手机号喷洒"（口令喷洒每号只试 1 次
    // 时单号桶永远打不满）。纯 IP 上限放宽到 3 倍，容得下家庭/公司 NAT 后的正常多人
    const now = Date.now();
    for (const [key, limit] of [[`${routeKey}|${ip}${phoneKey}`, maxPerMinute], [`${routeKey}|ip|${ip}`, maxPerMinute * 3]]) {
      let bucket = rateBuckets.get(key);
      if (!bucket || now > bucket.resetAt) {
        bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
        rateBuckets.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > limit) {
        return res.status(429).json({ error: '操作太频繁，请 1 分钟后再试' });
      }
    }
    // 惰性清理过期桶，避免 Map 无限增长；只清过期项，不清全部（防止被假 IP 洪水整体击穿限流）
    if (rateBuckets.size > 10000) {
      for (const [k, v] of rateBuckets) {
        if (now > v.resetAt) rateBuckets.delete(k);
      }
    }
    next();
  };
}

// ---------- 找回密码失败锁定：同手机号 5 次失败锁 15 分钟 ----------
const RESET_MAX_FAILS = 5;
const RESET_LOCK_MS = 15 * 60 * 1000;
const resetFails = new Map(); // phone -> { count, lockedUntil }
function resetLocked(phone) {
  const entry = resetFails.get(phone);
  return entry && entry.lockedUntil > Date.now();
}
function recordResetFail(phone) {
  const entry = resetFails.get(phone) || { count: 0, lockedUntil: 0 };
  // 锁定到期后从零重新计数：只封"连续答错"，否则攻击者每 15 分钟错一次就能把真用户的找回通道永久锁死
  if (entry.lockedUntil && Date.now() > entry.lockedUntil) entry.count = 0;
  entry.count += 1;
  if (entry.count >= RESET_MAX_FAILS) entry.lockedUntil = Date.now() + RESET_LOCK_MS;
  resetFails.set(phone, entry);
}
function clearResetFails(phone) {
  resetFails.delete(phone);
}

// 清理僵尸记录：pending 超过 20 分钟必然不会再有结果，标记为失败，
// 避免用户反复重提积出一堆"分析中"的记录
// 在"提交诊断"和"打开历史页"两个入口都调用，保证用户每次看到的状态都是准的
// 窗口必须大于 Dify 侧的硬超时（lib/dify.js HARD_TIMEOUT 15 分钟），
// 否则还在正常跑的记录会被误标失败（虽然最终仍会更新为 done，但中间状态会吓到用户，
// 且会放行用户重复提交，白等两次）
async function cleanStalePending(userId) {
  const staleAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  await supabase
    .from('run_records')
    .update({ status: 'failed' })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lt('created_at', staleAgo);
}

// 工作流输出的归一化闸门：报告必须是"含实际内容的对象"才算成功。
// 模型偶尔会返回无法解析的文本（思考块被截断、结构性 JSON 瑕疵），
// 若直接标 done 入库，用户会看到"报告已生成"、点开却是"报告数据异常"，还白扣一次额度。
function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
// 取诊断结论里的最高风险等级，用于列表页轻量展示
function topRiskLevel(diag) {
  const order = { 高: 3, 中: 2, 低: 1 };
  let top = null;
  const list = diag && Array.isArray(diag.diagnosis) ? diag.diagnosis : [];
  for (const it of list) {
    if (it && order[it.risk] && (!top || order[it.risk] > order[top])) top = it.risk;
  }
  return top;
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// ---------- 额度原子增减（CAS：update ... where quota = 读到的值）----------
// supabase-js 的 update 不支持 SQL 表达式，用"条件更新+重试"保证并发下不丢扣减/加次：
// 并发窗口内额度被别人改过 → 条件不匹配返回 0 行 → 重读再试，最多 3 次。
// 读库错误（网络抖动/DB 瞬断）与"CAS 耗尽"必须区分：前者 throw 交给调用方保留报告待结算，
// 不能混进 null 把已生成的报告销毁（用户白等 3-15 分钟）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function quotaDelta(userId, delta) {
  let lastReadErr = null;
  for (let i = 0; i < 3; i++) {
    const { data: u, error: readErr } = await supabase
      .from('users')
      .select('quota')
      .eq('id', userId)
      .single();
    if (readErr || !u) {
      if (readErr) { lastReadErr = readErr; await sleep(80); continue; }
      return null; // 用户不存在（已注销）
    }
    lastReadErr = null;
    const target = u.quota + delta;
    if (target < 0) return null; // 不允许扣成负数
    const { data: updated, error } = await supabase
      .from('users')
      .update({ quota: target })
      .eq('id', userId)
      .eq('quota', u.quota)
      .select('quota');
    if (error) throw new Error('额度更新失败：' + error.message);
    if (updated && updated.length) return updated[0].quota;
    // CAS 未命中（并发改动），重试
  }
  if (lastReadErr) throw new Error('额度读取失败：' + lastReadErr.message);
  return null;
}

// ---------- 输入校验 ----------
// 联系方式格式：手机号（11 位 1 开头）或邮箱，填了就必须合格，避免乱填导致无法回访
function isPhone(v) {
  return typeof v === 'string' && /^1\d{10}$/.test(v.trim());
}
function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

// 飞书群机器人推送：反馈提交后实时转发到你的飞书群（配 FEISHU_WEBHOOK_URL 生效），
// 推送失败只记日志，不影响存库主流程
async function pushFeishuFeedback({ content, contact, user }) {
  const hook = process.env.FEISHU_WEBHOOK_URL;
  if (!hook) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        msg_type: 'text',
        content: {
          text: `【跑悟·用户反馈】\n内容：${content}\n联系方式：${contact || '未留'}\n账号：${(user && user.phone) || '未知'}（${(user && user.nickname) || '-'}）\n时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
        },
      }),
    });
  } catch (e) {
    console.warn('[飞书推送失败]', e.message);
  } finally {
    clearTimeout(timer);
  }
}
// 密保答案归一化：忽略首尾空格与大小写差异，避免用户因输入形态找回失败
function normAnswer(v) {
  return String(v || '').trim().toLowerCase();
}

// 弱密码判定：纯数字或不足 8 位。注册/重置不硬拦（避免逼疯用户），但登录时提醒更改
function isWeakPassword(pw) {
  return /^\d+$/.test(String(pw)) || String(pw).length < 8;
}

// 找回密码第一步：根据手机号返回注册时设置的密保问题
app.post('/api/auth/security-question', rateLimit(5, 'secq'), wrap(async (req, res) => {
  const { phone } = req.body;
  if (!isPhone(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });
  const { data: user, error: qErr } = await supabase
    .from('users')
    .select('security_question')
    .eq('phone', phone.trim())
    .maybeSingle();
  if (qErr && /security_question/i.test(qErr.message || '')) {
    return res.status(500).json({ error: '找回功能尚未完成迁移：请在 Supabase SQL Editor 重跑 sql/schema.sql' });
  }
  if (qErr) return res.status(500).json({ error: '获取密保问题失败，请稍后重试' });
  if (!user) return res.status(404).json({ error: '该手机号未注册' });
  res.json({ question: user.security_question || null });
}));

// 健康检查带启动时间与版本：判断"改完代码是否真的重启过"就靠它——
// startedAt 早于最近一次代码修改时间 = 跑的还是旧进程
const SERVER_STARTED_AT = new Date().toISOString();
app.get('/api/health', (req, res) => res.json({ ok: true, version: require('../package.json').version, startedAt: SERVER_STARTED_AT }));

// 政策版本号：协议/隐私政策任何实质修改都要改这里并同步 legal/*.html，
// 同意留痕按版本记录，监管核查时可举证"用户同意的是哪一版"
const POLICY_VERSION = process.env.POLICY_VERSION || '2026-10-08';

// 同意留痕（PIPL 第 55-56 条）：注册勾选与健康数据单独同意逐条入库。
// 表未建（sql/schema.sql 未重跑）时不阻断主流程，只记日志——上线核查前必须补跑建表
async function logConsent(userId, phone, consentType, req) {
  try {
    const { error } = await supabase
      .from('user_consents')
      .insert({
        user_id: userId,
        phone: phone || null,
        consent_type: consentType,
        policy_version: POLICY_VERSION,
        ip: (req && (req.ip || '')).toString().slice(0, 64) || null,
      });
    if (error && /user_consents|relation/i.test(error.message || '')) {
      console.error('[consent] user_consents 表不存在，请到 Supabase SQL Editor 重跑 sql/schema.sql');
    } else if (error) {
      console.error('[consent] 留痕写入失败:', error.message);
    }
  } catch (e) { /* 留痕失败不影响业务 */ }
}

app.post('/api/auth/register', rateLimit(5, 'register'), wrap(async (req, res) => {
  const { phone, password, nickname, security_question, security_answer } = req.body;
  if (!isPhone(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  // 三项同意服务端强校验（不能只靠前端勾选框，直连 API 绕过前端无效）：
  // 协议+隐私政策 / 个人信息出境单独同意（PIPL 第 39 条）/ 年满 14 周岁声明
  const consents = req.body.consents || {};
  if (!consents.terms) return res.status(400).json({ error: '请先阅读并同意《用户服务协议》与《隐私政策》' });
  if (!consents.cross_border) return res.status(400).json({ error: '请先单独同意个人信息出境存储（正式上线前将迁回境内服务器）' });
  if (!consents.age) return res.status(400).json({ error: '请先确认本人已年满 14 周岁（14-18 周岁需在监护人知情同意下使用）' });
  // 密保问题/答案是自助找回密码的身份凭证（替代短信验证码，免备案免费），
  // 注册时必填；答案只存哈希，连数据库泄露也拿不到原文
  const question = String(security_question || '').trim();
  const answer = normAnswer(security_answer);
  if (!question || question.length < 4 || question.length > 60) {
    return res.status(400).json({ error: '请选择密保问题' });
  }
  if (answer.length < 2) return res.status(400).json({ error: '密保答案至少 2 个字，注册后将用于找回密码' });

  const { data: exist } = await supabase
    .from('users')
    .select('id')
    .eq('phone', phone.trim())
    .maybeSingle();
  if (exist) return res.status(409).json({ error: '该手机号已注册' });

  const passwordHash = await bcrypt.hash(password, 10);
  const answerHash = await bcrypt.hash(answer, 10);
  const { data: user, error } = await supabase
    .from('users')
    .insert({
      phone: phone.trim(),
      password_hash: passwordHash,
      nickname: String(nickname || '').trim().slice(0, 20) || '跑者',
      quota: 3,
      security_question: question,
      security_answer_hash: answerHash,
    })
    .select('id, phone, nickname, quota')
    .single();
  if (error) {
    // 密保字段未迁移（老库没重跑 schema.sql）时给出明确指引
    if (/security_question|security_answer/i.test(error.message || '')) {
      return res.status(500).json({ error: '注册功能尚未完成迁移：请在 Supabase SQL Editor 重跑 sql/schema.sql（新增密保字段）后重试' });
    }
    // 先查后插的并发窗口：撞 unique(phone) 时给客户端明确的 409，而不是笼统的 500
    if (error.code === '23505') {
      return res.status(409).json({ error: '该手机号已注册，请直接登录' });
    }
    return res.status(500).json({ error: '注册失败，请稍后重试' });
  }

  // 同意留痕：三项勾选逐条入库（表未建时降级为日志，不阻断注册）
  logConsent(user.id, phone.trim(), 'register_terms', req);
  logConsent(user.id, phone.trim(), 'cross_border', req);
  logConsent(user.id, phone.trim(), 'age_self', req);

  res.json({ token: signToken(user), user });
}));

app.post('/api/auth/login', rateLimit(10, 'login'), wrap(async (req, res) => {
  const { phone, password } = req.body;
  if (!isPhone(phone) || !password) return res.status(400).json({ error: '请输入正确的手机号和密码' });

  const { data: user, error: loginQErr } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone.trim())
    .maybeSingle();
  // DB 故障时返回 500，不能伪装成 401"密码错误"误导用户
  if (loginQErr) return res.status(500).json({ error: '登录服务暂时不可用，请稍后重试' });
  if (!user) return res.status(401).json({ error: '手机号或密码错误' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: '手机号或密码错误' });

  // 凭据字段绝不下发：密码哈希与密保答案哈希都留在服务端
  const securityQuestionSet = !!user.security_question;
  delete user.password_hash;
  delete user.security_answer_hash;
  delete user.security_question;
  user.security_question_set = securityQuestionSet;
  // 刚用明文验证过密码，顺手判强度：弱密码的账号在登录后弹窗提醒更改
  user.weak_password = isWeakPassword(password);
  res.json({ token: signToken(user), user });
}));

// 修改密码（已登录）：弱密码提醒的承接入口。验证当前密码，新密码沿用 ≥6 位下限，
// 弱密码不硬拦（有人就想要好记的），但响应里带回强度标记让前端继续提示
app.post('/api/auth/change-password', rateLimit(5, 'chpw'), auth, wrap(async (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');
  if (!current) return res.status(400).json({ error: '请输入当前密码' });
  if (!next || next.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  if (next === current) return res.status(400).json({ error: '新密码不能与当前密码相同' });
  const { data: me, error: selErr } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', req.user.id)
    .single();
  if (selErr || !me) return res.status(401).json({ error: '账号不存在' });
  const ok = await bcrypt.compare(current, me.password_hash);
  if (!ok) return res.status(403).json({ error: '当前密码不正确' });
  const passwordHash = await bcrypt.hash(next, 10);
  const { error } = await supabase
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('id', req.user.id);
  if (error) return res.status(500).json({ error: '修改失败，请稍后重试' });
  res.json({ ok: true, weak_password: isWeakPassword(next) });
}));

// 找回密码：手机号 + 密保答案
// 防护：IP 限流 3 次/分钟 + 同手机号 5 次失败锁 15 分钟；开放公网注册后建议升级短信验证码。
app.post('/api/auth/reset-password', rateLimit(3, 'reset'), wrap(async (req, res) => {
  const { phone, new_password, security_answer } = req.body;
  if (!isPhone(phone)) return res.status(400).json({ error: '请输入正确的 11 位手机号' });
  if (!new_password || String(new_password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });

  const normalizedPhone = phone.trim();
  if (resetLocked(normalizedPhone)) {
    return res.status(429).json({ error: '尝试次数过多，请 15 分钟后再试' });
  }

  const { data: user, error: selErr } = await supabase
    .from('users')
    .select('id, security_question, security_answer_hash')
    .eq('phone', normalizedPhone)
    .maybeSingle();
  if (selErr && /security_/i.test(selErr.message || '')) {
    return res.status(500).json({ error: '找回功能尚未完成迁移：请在 Supabase SQL Editor 重跑 sql/schema.sql（新增密保字段）后重试' });
  }
  if (selErr) return res.status(500).json({ error: '查询账号失败，请稍后重试' });
  if (!user) return res.status(404).json({ error: '该手机号未注册' });

  if (!user.security_answer_hash) {
    return res.status(403).json({ error: '该账号未设置密保问题，请联系管理员重置密码' });
  }
  // 密保答案只存哈希，比对用 bcrypt
  const answer = normAnswer(security_answer);
  if (answer.length < 2) return res.status(400).json({ error: '请输入密保答案' });
  const ok = await bcrypt.compare(answer, user.security_answer_hash);
  if (!ok) {
    recordResetFail(normalizedPhone);
    return res.status(403).json({ error: '密保答案不正确，无法重置密码' });
  }
  clearResetFails(normalizedPhone);

  const passwordHash = await bcrypt.hash(new_password, 10);
  const { error } = await supabase
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('id', user.id);
  if (error) return res.status(500).json({ error: '重置失败，请稍后重试' });

  res.json({ ok: true, message: '密码已重置，请使用新密码登录' });
}));

app.get('/api/auth/me', auth, wrap(async (req, res) => {
  const { data: user, error: meErr } = await supabase
    .from('users')
    .select('id, phone, nickname, quota, security_question')
    .eq('id', req.user.id)
    .single();
  if (meErr) return res.status(500).json({ error: '暂时无法获取账号信息，请稍后重试' });
  if (!user) return res.status(404).json({ error: '用户不存在' });
  // 只暴露"是否已设置"，不回传问题原文（找回流程按手机号单独取）
  const { security_question, ...safeUser } = user;
  res.json({ user: { ...safeUser, security_question_set: !!security_question } });
}));

// 设置/更换密保问题：老账号（密保字段上线前注册）登录后在此补设，忘答的也能换。
// 必须验证当前登录密码：密保问答 = 找回密码的身份凭证，能改它 ≈ 能接管账号，
// 所以权限等级要对齐注销（同样要求密码），不能只靠持有 token
app.post('/api/auth/set-security', rateLimit(3, 'set-secq'), auth, wrap(async (req, res) => {
  const question = String(req.body.security_question || '').trim();
  const answer = normAnswer(req.body.security_answer);
  if (!question || question.length < 4 || question.length > 60) return res.status(400).json({ error: '请选择密保问题' });
  if (answer.length < 2) return res.status(400).json({ error: '密保答案至少 2 个字，请务必牢记' });
  if (!req.body.current_password) return res.status(400).json({ error: '请输入当前密码以确认是本人操作' });
  const { data: me } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', req.user.id)
    .single();
  if (!me) return res.status(401).json({ error: '账号不存在' });
  const pwOk = await bcrypt.compare(String(req.body.current_password), me.password_hash);
  if (!pwOk) return res.status(403).json({ error: '当前密码不正确，保存已取消' });
  const answerHash = await bcrypt.hash(answer, 10);
  const { error } = await supabase
    .from('users')
    .update({ security_question: question, security_answer_hash: answerHash })
    .eq('id', req.user.id);
  if (error && /security_/i.test(error.message || '')) {
    return res.status(500).json({ error: '密保功能尚未完成迁移：请在 Supabase SQL Editor 重跑 sql/schema.sql' });
  }
  if (error) return res.status(500).json({ error: '保存失败，请稍后重试' });
  res.json({ ok: true });
}));

// ---------- 账号：数据导出 / 注销（《个人信息保护法》的可携带权与删除权）----------

// 数据导出：把该用户全部个人数据打包成一份 JSON 交还本人。
// 绝不含 password_hash / security_answer_hash —— 那是身份凭据，不属于"个人信息副本"应交付的内容，
// 交出去等于把账号的钥匙一起给了。
app.get('/api/account/export', rateLimit(5, 'export'), auth, wrap(async (req, res) => {
  const uid = req.user.id;
  const [me, records, orders, feedbacks] = await Promise.all([
    supabase.from('users').select('id, phone, nickname, quota, created_at').eq('id', uid).maybeSingle(),
    supabase.from('run_records').select('*').eq('user_id', uid).order('version', { ascending: true }),
    supabase.from('orders').select('id, amount, status, created_at').eq('user_id', uid).order('created_at', { ascending: true }),
    supabase.from('feedback').select('id, content, contact, created_at').eq('user_id', uid).order('created_at', { ascending: true }),
  ]);
  if (!me.data) return res.status(404).json({ error: '账号不存在或已注销' });

  res.json({
    exported_at: new Date().toISOString(),
    notice: '本文件包含你在「跑悟 · AI 跑步诊断」的全部个人数据副本。其中诊断记录里的图片为存储桶链接，账号注销后链接即失效，如需长期保存请另行下载图片。',
    account: me.data,
    diagnosis_records: records.data || [],
    orders: orders.data || [],
    feedback: feedbacks.data || [],
  });
}));

// 注销账号：两次确认——登录密码（证明是本人）+ 手输「注销」二字（防误触/防被顺手点掉）。
// 顺序是刻意的：先清存储桶图片，再删数据库。因为图片只按 user_id/ 前缀存放，
// 一旦 users 行删掉、run_records 被级联清除，就再没有线索能找回该用户传过哪些图，
// 只会留下一堆永远清不掉的孤儿文件。存储清理失败就整体中止，不留"半注销"状态。
// 限流 5 次/分钟：注销是法定权利，不该因为手误（确认词打错一次、密码打错一次）就被锁 1 分钟；
// 同时这个频率仍足以挡住靠该接口爆破密码的尝试。
app.delete('/api/account', rateLimit(5, 'delacct'), auth, wrap(async (req, res) => {
  const uid = req.user.id;
  const { password, confirm } = req.body || {};

  if (String(confirm || '').trim() !== '注销') {
    return res.status(400).json({ error: '请在确认框里手动输入「注销」两个字' });
  }
  if (!password) return res.status(400).json({ error: '请输入登录密码' });

  const { data: me, error: delQErr } = await supabase
    .from('users')
    .select('id, password_hash')
    .eq('id', uid)
    .maybeSingle();
  if (delQErr) return res.status(500).json({ error: '暂时无法注销，请稍后重试' });
  if (!me) return res.status(404).json({ error: '账号不存在或已注销' });
  if (!(await bcrypt.compare(String(password), me.password_hash))) {
    return res.status(403).json({ error: '密码不正确，注销已取消' });
  }

  // 1) 清存储桶：分页列出该用户目录下的全部图片再批量删（单次 list 默认只回 100 条）
  const paths = [];
  for (let offset = 0; ; offset += 100) {
    const { data: files, error } = await supabase.storage.from(BUCKET).list(uid, { limit: 100, offset });
    if (error) return res.status(500).json({ error: '图片清除失败，账号未注销，请稍后重试：' + error.message });
    if (!files || !files.length) break;
    paths.push(...files.filter((f) => f && f.name).map((f) => `${uid}/${f.name}`));
    if (files.length < 100) break;
  }
  if (paths.length) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths);
    if (error) return res.status(500).json({ error: '图片清除失败，账号未注销，请稍后重试：' + error.message });
  }

  // 2) feedback 的外键是 on delete set null（保留内容、只断开关联），
  //    对"注销即删除"来说不够，必须显式删，否则用户写的反馈会以匿名形式留在库里
  await supabase.from('feedback').delete().eq('user_id', uid);

  // 2.5) 清掉该用户尚未下载的待导出 PDF（注销承诺"全部个人数据已删除"，buffer 里也是个人报告）
  for (const [k, v] of pdfSessions) if (v.uid === uid) pdfSessions.delete(k);

  // 3) 删 users 行：run_records 与 orders 都是 on delete cascade，会随之清空。
  //    注：将来接入真实支付后，orders 涉及交易凭证的留存义务，这里要改成
  //    "匿名化保留订单、删除其余"，不能继续直接级联删。
  const { error: delErr } = await supabase.from('users').delete().eq('id', uid);
  if (delErr) return res.status(500).json({ error: '注销失败，请稍后重试' });

  res.json({
    ok: true,
    removed_images: paths.length,
    message: '账号已注销，全部个人数据已删除',
  });
}));

// 上传仅允许 JPG/PNG/WebP：按文件魔数判断，不信任客户端给的文件名与 Content-Type
const IMAGE_TYPES = [
  { ext: 'jpg', mime: 'image/jpeg', match: (b) => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { ext: 'png', mime: 'image/png', match: (b) => b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  { ext: 'webp', mime: 'image/webp', match: (b) => b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
];

// 请求总大小预检：multer 的 fileSize 只限单文件，10 张 × 2MB 仍可在内存驻留 20MB+。
// 超过 25MB 的请求直接 413，不进 multer 缓冲（防认证用户连续大请求打 OOM）
function totalSizeCap(maxBytes) {
  return (req, res, next) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return res.status(413).json({ error: `请求总体积过大（上限 ${Math.round(maxBytes / 1024 / 1024)}MB），请减少图片数量或分段上传` });
    }
    next();
  };
}

app.post('/api/upload', rateLimit(5, 'upload'), auth, totalSizeCap(25 * 1024 * 1024), imageUpload.array('images', MAX_IMAGES), wrap(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '请选择至少一张图片' });
  }
  // 注销后旧 token 在 TTL 内仍有效：写存储前确认账号还在，避免给已注销用户留下无人清理的孤儿文件
  const { data: liveUser, error: liveErr } = await supabase.from('users').select('id').eq('id', req.user.id).maybeSingle();
  if (liveErr) return res.status(500).json({ error: '上传服务暂时不可用，请稍后重试' });
  if (!liveUser) return res.status(401).json({ error: '账号已注销，请重新注册' });

  const urls = [];
  for (const file of req.files) {
    const type = IMAGE_TYPES.find((t) => t.match(file.buffer));
    if (!type) return res.status(400).json({ error: '仅支持 JPG / PNG / WebP 格式图片，请重新选择' });
    const name = `${req.user.id}/${Date.now()}-${randomUUID()}.${type.ext}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(name, file.buffer, { contentType: type.mime });
    if (error) return res.status(500).json({ error: '图片上传失败：' + error.message });

    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(name, SIGNED_URL_TTL);
    if (signErr) return res.status(500).json({ error: '图片上传失败：' + signErr.message });
    urls.push(signed.signedUrl);
  }

  res.json({ urls });
}));

// ---------- PDF 导出中转：微信内置浏览器的唯一可靠出口 ----------
// 微信 webview 没有保存文件的能力：blob 下载会被拦截并跳外部浏览器打开空白的 blob: 页面
// （文件不落地），Web Share 又没有可靠实现。它唯一可靠的口子是"真实 HTTP 地址的 PDF"——
// 微信自带文件预览器会打开，右上角菜单里可以保存 / 用其他应用打开。
// 所以前端把生成好的 PDF POST 上来，换一个短时随机令牌的真实 URL 去打开。
// 令牌即凭证（与 Supabase 签名 URL 同一安全模型）：GET 不再验登录头，因为 <a>/window.open
// 导航发不出 Authorization 头；令牌 256 位随机、15 分钟过期，不可枚举。
const pdfSessions = new Map(); // token -> { buffer, name, expires, uid }
// 进程级互斥：同一账号同时只允许一份诊断在跑（diagnose 路由的 finish 事件负责释放）
const diagnoseInFlight = new Set();
const PDF_SESSION_TTL = Number(process.env.PDF_SESSION_TTL_MS) || 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pdfSessions) if (v.expires < now) pdfSessions.delete(k);
}, 60 * 1000).unref();

app.post('/api/export/pdf', rateLimit(10, 'pdf-export'), auth, pdfUpload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '缺少 PDF 文件' });
  const token = (randomUUID() + randomUUID()).replace(/-/g, ''); // 256 位随机
  // multer/busboy 把 UTF-8 文件名按 latin1 解码，中文会变乱码（微信预览器顶栏会显示出来），
  // 含高位字节时转回真实 UTF-8
  let name = req.file.originalname || '';
  if (/[\u00c0-\u00ff]/.test(name)) name = Buffer.from(name, 'latin1').toString('utf8');
  // 只收真 PDF：multer 只看大小，不看内容；内容校验放这里
  if (!req.file || req.file.buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
    return res.status(400).json({ error: '文件不是有效的 PDF，请重新生成后再试' });
  }
  pdfSessions.set(token, {
    buffer: req.file.buffer,
    name: name || '跑悟AI跑步报告.pdf',
    expires: Date.now() + PDF_SESSION_TTL,
    uid: req.user.id, // 记录归属：注销时清掉本人的待下载 PDF
  });
  // 内存上限保护：按字节总量封顶（单份最大 10MB，份数封顶防不住峰值内存），超限先清最早过期的一批
  const PDF_BYTES_CAP = 100 * 1024 * 1024;
  if (pdfSessions.size > 50) {
    const oldest = [...pdfSessions.entries()].sort((a, b) => a[1].expires - b[1].expires);
    for (let i = 0; i < oldest.length - 50; i++) pdfSessions.delete(oldest[i][0]);
  }
  let totalBytes = 0;
  for (const v of pdfSessions.values()) totalBytes += v.buffer.length;
  while (totalBytes > PDF_BYTES_CAP && pdfSessions.size > 1) {
    const oldestKey = [...pdfSessions.entries()].sort((a, b) => a[1].expires - b[1].expires)[0][0];
    totalBytes -= pdfSessions.get(oldestKey).buffer.length;
    pdfSessions.delete(oldestKey);
  }
  res.json({ url: `/api/export/pdf/${token}.pdf`, expires_in: Math.floor(PDF_SESSION_TTL / 1000) });
}));

app.get('/api/export/pdf/:token', (req, res) => {
  const token = String(req.params.token || '').replace(/\.pdf$/, '');
  const s = pdfSessions.get(token);
  if (!s || s.expires < Date.now()) {
    return res.status(404).json({ error: '导出链接已过期，请回到报告页重新导出' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  // inline：微信/iOS 的预览器直接展示；文件名走 RFC 5987 编码（中文名）
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(s.name)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(s.buffer);
});

app.post('/api/diagnose', rateLimit(5, 'diagnose'), auth, wrap(async (req, res) => {
  const checked = normalizeSubmission(req.body);
  if (checked.error) return res.status(checked.status || 400).json({ error: checked.error });
  const input = checked.value;

  // 进程级互斥：下方"只允许一份分析中"靠先查后插，并发双击存在竞态窗口；
  // 单进程部署下用内存锁补上，响应结束（任何返回路径）自动释放
  if (diagnoseInFlight.has(req.user.id)) {
    return res.status(400).json({ error: '上一次分析还在进行中，请等它完成再提交' });
  }
  diagnoseInFlight.add(req.user.id);
  // 挂 close 而不是 finish：诊断要跑数分钟，用户刷新/关页断连时 finish 永不触发
  // （已实证 node v24 只发 close），锁会泄漏到进程重启，用户被永久禁止诊断。
  // close 在正常完成与客户端中断两种情况下都会触发，且 Set.delete 幂等
  res.on('close', () => diagnoseInFlight.delete(req.user.id));

  // 注销后旧 token 在 TTL 内仍有效：开工前确认账号还在
  const { data: liveUser, error: liveErr } = await supabase.from('users').select('id').eq('id', req.user.id).maybeSingle();
  if (liveErr) return res.status(500).json({ error: '诊断服务暂时不可用，请稍后重试' });
  if (!liveUser) return res.status(401).json({ error: '账号已注销，请重新注册' });

  // 图片：限 10 张；从地址里取出对象路径，并强制它落在**本人目录**下。
  // 旧的校验只看"是不是本站桶的公开地址"，没看归属——塞别人的图片地址同样能通过。
  const images = Array.isArray(req.body.images) ? req.body.images : [];
  if (images.length === 0) {
    return res.status(400).json({ error: '请先上传至少一张跑步数据截图或照片' });
  }
  if (images.length > MAX_IMAGES) {
    return res.status(400).json({ error: `最多上传 ${MAX_IMAGES} 张图片` });
  }
  const imagePaths = [];
  for (const u of images) {
    const p = imageObjectPath(u);
    if (!p || !p.startsWith(req.user.id + '/')) {
      return res.status(400).json({ error: '图片链接无效，请删除已上传图片后重新上传' });
    }
    imagePaths.push(p);
  }

  // Dify 用 remote_url 自己拉图，所以入库前先把路径现签成可访问 URL。
  // 放在入库之前：签名失败就直接返回，不必回头清理刚写下的 pending 记录。
  let imageUrls;
  try {
    imageUrls = await signImagePaths(imagePaths);
  } catch (e) {
    return res.status(500).json({ error: e.message + '，请删除已上传图片后重新上传' });
  }

  // 结构化填报数据：图片识别可能受限（模型看不到图），这些数字是诊断的核心依据
  // 拼成自描述的【填报数据】块追加到 user_text，不用改扣子工作流即可让模型用到
  const text = input.user_text;
  const filled = [];
  const push = (label, v) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') filled.push(`${label}：${String(v).trim()}`);
  };
  push('性别', input.gender);
  push('年龄(岁)', input.age);
  push('身高(cm)', input.height);
  push('体重(kg)', input.weight);
  push('跑龄', input.run_years);
  push('最近7天累计跑量(km)', input.weekly_volume);
  push('最近一次典型跑步配速', input.avg_pace);
  push('最近一次典型跑步平均心率(bpm)', input.avg_hr);
  push('步频(spm)', input.cadence);
  push('警示症状自评', input.safety_status === 'none' ? '无' : '不确定');
  push('本次实际上传图片张数', images.length);
  const fullText = [text, filled.length ? '【填报数据】' + filled.join(' | ') : '']
    .filter(Boolean)
    .join('\n\n');

  const raceDate = input.race_date;

  // 只要上一份报告仍在分析，就不允许开始第二份；模型可能运行数分钟。
  // 先清理超过模型硬超时的僵尸任务，再检查所有 pending，而非只看 60 秒。
  await cleanStalePending(req.user.id);
  const { data: pendingRow } = await supabase
    .from('run_records')
    .select('id, created_at')
    .eq('user_id', req.user.id)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();
  if (pendingRow) {
    return res.status(400).json({ error: '上一次提交还在分析中（约需 3-5 分钟），请稍候或在历史记录中查看结果' });
  }

  // 读取失败 ≠ 次数用完：网络或库抖动时 data 为 null，老逻辑会误报"次数已用完"并弹充值框，
  // 让还有几十次额度的用户白跑一趟（真水无香反馈：剩余 88 次仍提示次数不足）。
  // 读不到就老实报"服务异常"，只有确凿读到 quota<=0 才算用完。
  const { data: user, error: quotaErr } = await supabase
    .from('users')
    .select('quota')
    .eq('id', req.user.id)
    .single();
  if (quotaErr || !user) {
    console.error('[额度读取失败]', req.user.id, quotaErr && quotaErr.message);
    return res.status(500).json({ error: '网络异常，请稍后重试（本次未扣除诊断次数）' });
  }
  if (user.quota <= 0) {
    return res.status(402).json({ error: '免费次数已用完，请充值后继续', need_pay: true });
  }

  // 版本号取该用户现有最大 version + 1，而不是记录总数 + 1：
  // 删除记录会造成总数与编号错位（例如只剩 v7 时新记录会拿到 v2，序号就乱了），用最大值保证新编号永远递增。
  // 并发提交同一账号时可能撞 unique(user_id, version)，这里自动重算重试一次。
  let record = null;
  let recErr = null;
  for (let attempt = 0; attempt < 2 && !record; attempt++) {
    const { data: maxRow } = await supabase
      .from('run_records')
      .select('version')
      .eq('user_id', req.user.id)
      .order('version', { ascending: false })
      .limit(1);
    const version = (maxRow && maxRow.length ? maxRow[0].version : 0) + 1;

    const inserted = await supabase
      .from('run_records')
      .insert({
        user_id: req.user.id,
        version,
        // 存对象路径而不是完整 URL：签名会过期，路径不会，将来要看原图按需现签即可
        images: imagePaths,
        user_text: fullText,
        goal: input.goal,
        race_date: raceDate,
        status: 'pending',
      })
      .select('id')
      .single();
    record = inserted.data;
    recErr = inserted.error;
    if (recErr && recErr.code !== '23505') break; // 非唯一约束冲突不用重试
  }
  if (recErr || !record) return res.status(500).json({ error: '创建诊断记录失败，请稍后重试' });

  const { data: historyRows } = await supabase
    .from('run_records')
    .select('version, created_at, recognition, diagnosis')
    .eq('user_id', req.user.id)
    .eq('status', 'done')
    .order('version', { ascending: false })
    .limit(5);

  // 每次仍生成一份全新的 8 周计划。历史活动和月汇总跨报告去重，
  // 避免同一截图重新提交后被模型算成新增里程；不推测旧计划完成度。
  const history = buildHistoryEvidence(historyRows || []);

  try {
    const output = await runWorkflow({
      images: imageUrls,
      userText: fullText,
      goal: input.goal,
      raceDate,
      history: JSON.stringify(history),
    });

    const recognitionCheck = normalizeRecognition(output && output.recognition, images.length, input);
    const diagnosisCheck = validateDiagnosis(output, input.goal, input.race_date);
    const recognitionWarnings = recognitionCheck.value && recognitionCheck.value.data_warnings || [];
    // A diagnosis has already used the raw extraction. Any rejected value or
    // disputed attribution could therefore have influenced its plan.
    if (recognitionCheck.error || diagnosisCheck.error || recognitionWarnings.length) {
      const reason = recognitionCheck.error || diagnosisCheck.error || recognitionWarnings[0];
      console.error(`[分析结果校验失败] provider=${AI_PROVIDER} record=${record.id} reason=${reason}`);
      await supabase
        .from('run_records')
        .update({ status: 'failed', summary: `分析失败：${reason}（未扣次数）` })
        .eq('id', record.id);
      return res.status(422).json({
        error: `分析结果需要重新核对：${reason}。本次未扣次数；请核对图片日期或补充所需数据后重试`,
      });
    }
    const recognition = recognitionCheck.value;
    recognition.user_provided = {
      gender: input.gender, age: input.age, height_cm: input.height, weight_kg: input.weight,
      run_years: input.run_years, weekly_volume_km: input.weekly_volume,
      avg_pace: input.avg_pace, avg_heart_rate: input.avg_hr, cadence_spm: input.cadence,
      safety_status: input.safety_status,
    };
    const diag = diagnosisCheck.value;
    output.recognition = recognition;
    output.diagnosis_result = diag;

    // 核心落库：这三列在建表时就存在，必须成功，否则报告存不下来
    // 同时留痕本次健康数据单独同意（consent_health 已在 normalizeSubmission 强校验为 true）。
    // JWT 只带 id 不带手机号，phone 留空——账号存活期间 user_id 足以关联归属
    logConsent(req.user.id, null, 'health_data', req);
    const { error: coreErr } = await supabase
      .from('run_records')
      .update({
        status: 'done',
        recognition,
        diagnosis: diag,
      })
      .eq('id', record.id);
    if (coreErr) {
      // 报告没存下来 → 不扣额度，让用户放心重试
      await supabase
        .from('run_records')
        .update({ status: 'failed', summary: '报告保存失败：' + coreErr.message })
        .eq('id', record.id);
      return res.status(500).json({
        error: '报告保存失败（' + coreErr.message + '），本次未扣除诊断次数，请重试',
      });
    }

    // 摘要冗余字段：列表页加速用，列不存在或写入失败都不影响主流程
    await supabase
      .from('run_records')
      .update({
        summary: typeof diag.summary === 'string' && diag.summary ? diag.summary : null,
        risk_level: topRiskLevel(diag),
        goal_type: input.goal,
      })
      .eq('id', record.id);

    // 扣额度：报告确认落库后再扣；quotaDelta 用条件更新+重试保证并发下不丢扣减
    let afterQuota = null;
    let quotaReadFailed = false;
    try {
      afterQuota = await quotaDelta(req.user.id, -1);
    } catch (quotaErr) {
      // 读库/写库故障：报告已生成，宁可不扣次也绝不销毁——留日志人工核对补扣
      quotaReadFailed = true;
      console.error(`[结算待补] 报告已保留但额度结算失败 record=${record.id} user=${req.user.id}:`, quotaErr.message);
    }
    if (afterQuota === null && !quotaReadFailed) {
      // 结算失败（额度不足/用户不存在）时撤销可读报告，不能把未扣费的结果留在历史记录里。
      await supabase.from('run_records').update({
        status: 'failed', recognition: null, diagnosis: null,
        summary: '报告结算失败，本次未扣次数，请稍后重试', risk_level: null,
      }).eq('id', record.id);
      return res.status(503).json({ error: '报告结算失败，本次未扣次数，请稍后重试' });
    }

    res.json({ record_id: record.id, result: output, recognition });
  } catch (e) {
    // 工作流失败：额度从未扣除，无需"退回"，直接标记记录失败
    // 失败原因存入 summary，历史页直接可见，便于排查"为什么失败"
    await supabase
      .from('run_records')
      .update({ status: 'failed', recognition: null, diagnosis: null, risk_level: null, summary: '分析失败：' + (e.message || 'AI 工作流异常') })
      .eq('id', record.id);
    res.status(500).json({
      error: '分析失败：' + e.message + '（本次未扣除诊断次数；若历史记录里已出现该次诊断，可直接点开查看结果）',
    });
  }
}));

// 列表页只查轻量字段，不拉整个 diagnosis JSON；支持分页
app.get('/api/records', auth, wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const status = req.query.status;
  if (status && !['done', 'failed', 'pending'].includes(status)) {
    return res.status(400).json({ error: '无效的记录状态' });
  }

  // 打开历史页时先清理一遍僵尸记录，让卡住的"分析中"及时变成"失败"
  if (!status) await cleanStalePending(req.user.id);

  // 自愈：修复历史遗留的断档编号（进程被杀导致重编号中断时可能留下 1..6,8 之类的洞）。
  // 不阻塞响应，失败也不影响读取；同步的删除路径已保证正常情况下不会产生断档
  renumberVersions(req.user.id).catch((e) => console.error('[renumber] 自愈失败:', e.message || e));

  let query = supabase
    .from('run_records')
    .select('id, version, status, goal, summary, risk_level, goal_type, created_at, diagnosis->>risk_alert', { count: 'exact' })
    .eq('user_id', req.user.id);
  if (status) query = query.eq('status', status);
  const { data: records, count, error } = await query
    // 按创建时间降序而不是 version 降序：删除记录重编号后 version 不再等于时间顺序，
    // 主页"我的档案"取第一条作为"最近一次诊断"，必须按真实时间取最新的那条
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return res.status(500).json({ error: '读取历史记录失败，请稍后重试' });

  res.json({
    records: records || [],
    total: count || 0,
    has_more: offset + limit < (count || 0),
  });
}));

app.get('/api/records/:id', auth, wrap(async (req, res) => {
  const { data: record, error: recErr } = await supabase
    .from('run_records')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (recErr) return res.status(500).json({ error: '暂时无法读取报告，请稍后重试' });
  if (!record) return res.status(404).json({ error: '记录不存在或无权访问' });
  // is_latest：是否为最新一次完成的诊断（按 created_at，不依赖 version，删记录重编号不影响）。
  // superseded_at：被下一条更新的诊断取代的时间。旧报告的 8 周计划已作废，
  // 前端用它计算"该计划当时进行到了第几周"，而不是显示"进行中"。
  const { data: next } = await supabase
    .from('run_records')
    .select('created_at')
    .eq('user_id', req.user.id)
    .eq('status', 'done')
    .gt('created_at', record.created_at)
    .order('created_at', { ascending: true })
    .limit(1);
  const isLatest = !next || !next.length;
  res.json({ record, is_latest: isLatest, superseded_at: isLatest ? null : next[0].created_at });
}));

// 删除后把剩余记录按时间升序重编 version（"第 7 次"变回"第 1 次"）
// best-effort：并发窗口内可能失败造成编号暂时空洞，不影响功能，下次删除会自动纠正
async function renumberVersions(userId) {
  const { data: remain } = await supabase
    .from('run_records')
    .select('id, version')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (!remain || !remain.length) return;
  // 幂等：版本号已经连续的行跳过不动，减少无谓写入
  if (remain.every((r, i) => r.version === i + 1)) return;
  // 有 unique(user_id, version) 约束，直接改会撞索引：先用负数占位，再分配正数
  for (let i = 0; i < remain.length; i++) {
    if (remain[i].version === -(i + 1)) continue;
    const { error } = await supabase.from('run_records').update({ version: -(i + 1) }).eq('id', remain[i].id);
    if (error) throw new Error(`占位失败(version→-${i + 1}): ${error.message}`);
  }
  for (let i = 0; i < remain.length; i++) {
    const { error } = await supabase.from('run_records').update({ version: i + 1 }).eq('id', remain[i].id);
    if (error) throw new Error(`回填失败(version→${i + 1}): ${error.message}`);
  }
}

app.delete('/api/records/:id', auth, wrap(async (req, res) => {
  const { data: record, error: delQErr } = await supabase
    .from('run_records')
    .select('id, user_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (delQErr) return res.status(500).json({ error: '删除失败，请稍后重试' });
  if (!record) return res.status(404).json({ error: '记录不存在' });
  if (record.user_id !== req.user.id) return res.status(403).json({ error: '无权删除该记录' });

  const { error } = await supabase.from('run_records').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: '删除失败，请稍后重试' });

  // 重编号必须等执行完再响应：之前放后台跑，一旦进程重启/被杀就留下断档编号（第8、第6、第5……）。
  // 记录数有限（每次 2N 次轻量更新），同步等待可接受
  try {
    await renumberVersions(req.user.id);
  } catch (e) {
    console.error('[renumber] 删除后重编号失败:', e.message || e);
  }

  res.json({ ok: true });
}));

// 趋势数据：周跑量 / 平均心率随诊断次数的变化，供前端画折线图
app.get('/api/trends', auth, wrap(async (req, res) => {
  const { data: rows } = await supabase
    .from('run_records')
    .select('version, created_at, recognition, diagnosis')
    .eq('user_id', req.user.id)
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(20);

  const safeJson = (v) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

  const series = (rows || []).slice().reverse().map((r) => trendPoint({
    ...r, recognition: safeJson(r.recognition), diagnosis: safeJson(r.diagnosis),
  }));

  res.json({ series });
}));

// 模拟支付仅可在显式开启的非生产测试环境使用；默认关闭。
app.get('/api/pay/availability', auth, (req, res) => {
  res.json({ mock_enabled: process.env.NODE_ENV !== 'production' && process.env.PAY_MODE === 'mock' });
});
app.post('/api/pay', rateLimit(3, 'pay'), auth, wrap(async (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.PAY_MODE !== 'mock') {
    return res.status(403).json({ error: '支付通道暂未开放，请联系管理员' });
  }

  const { error: orderErr } = await supabase.from('orders').insert({
    user_id: req.user.id,
    amount: 9.9,
    status: 'mock_paid',
  });
  if (orderErr) return res.status(500).json({ error: '创建测试订单失败，请稍后重试' });

  // 条件更新+重试的原子自增，避免并发充值丢失加次
  const afterQuota = await quotaDelta(req.user.id, 1);
  if (afterQuota === null) {
    return res.status(500).json({ error: '充值到账失败，请联系管理员核对' });
  }

  res.json({ ok: true, message: '充值成功（验证期模拟支付），已到账 1 次诊断' });
}));

// 意见反馈：存 feedback 表 + 实时推送到飞书群（FEISHU_WEBHOOK_URL 配置后生效）
// 反馈查看渠道：飞书群消息（实时）或 Supabase 后台 Table Editor 的 feedback 表（归档）
app.post('/api/feedback', rateLimit(3, 'feedback'), auth, wrap(async (req, res) => {
  const content = String(req.body.content || '').trim();
  const contact = String(req.body.contact || '').trim();
  if (content.length < 5) return res.status(400).json({ error: '反馈内容至少 5 个字' });
  if (content.length > 500) return res.status(400).json({ error: '反馈内容不能超过 500 字' });
  if (contact.length > 50) return res.status(400).json({ error: '联系方式不能超过 50 字' });
  // 联系方式选填，但填了就必须是合法手机号或邮箱：乱填等于无法回访，还可能是垃圾信息
  if (contact && !isPhone(contact) && !isEmail(contact)) {
    return res.status(400).json({ error: '联系方式格式不对：请填 11 位手机号或正确的邮箱' });
  }

  const { data: me } = await supabase
    .from('users')
    .select('phone, nickname')
    .eq('id', req.user.id)
    .single();

  const { error } = await supabase
    .from('feedback')
    .insert({ user_id: req.user.id, content, contact: contact || null });
  if (error) {
    // feedback 表还没建（老库未重跑 schema.sql）时给出明确指引，而不是笼统的"稍后重试"
    if (error.code === 'PGRST205' || /feedback|does not exist|schema/i.test(error.message || '')) {
      return res.status(500).json({ error: '反馈功能尚未初始化：请在 Supabase SQL Editor 重跑 sql/schema.sql（会自动创建 feedback 表）后重试' });
    }
    return res.status(500).json({ error: '提交失败，请稍后重试' });
  }

  // 存库成功后推送飞书（异步、失败不影响结果）
  pushFeishuFeedback({ content, contact, user: me });

  res.json({ ok: true, message: '感谢反馈！我们会尽快处理' });
}));

// ---------- 统一兜底：JSON 解析错误、multer 错误、其余异常一律返回 JSON ----------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const isPdfRoute = (req.originalUrl || req.url || '').startsWith('/api/export/pdf');
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? (isPdfRoute ? 'PDF 文件不能超过 10MB，请减少报告内容后重试' : '单张图片不能超过 2MB，请压缩后重新选择')
      : err.code === 'LIMIT_UNEXPECTED_FILE'
        ? `一次最多上传 ${MAX_IMAGES} 张图片`
        : '图片上传失败：' + err.message;
    return res.status(400).json({ error: msg });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求数据格式错误' });
  }
  console.error('[服务器错误]', err);
  if (res.headersSent) return next(err);
  // 5x 不把内部异常细节（Supabase/上游报错原文）下发给客户端，只进日志
  const status = err.status || 500;
  res.status(status).json({
    error: status >= 500 ? '服务器开小差了，请稍后重试；若反复出现请通过「反馈」联系我们' : (err.message || '请求失败'),
  });
});

// 未匹配到的路径统一返回 JSON 404（避免落到静态文件默认的 HTML 404）
app.use((req, res) => res.status(404).json({ error: '接口不存在' }));

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`服务已启动: http://localhost:${PORT}`);
    if (!process.env.SUPABASE_URL || !process.env.COZE_WORKFLOW_ID) {
      console.log('提示：请先复制 .env.example 为 .env 并填写 Supabase 与扣子配置');
    }
  });
}

module.exports = app;
