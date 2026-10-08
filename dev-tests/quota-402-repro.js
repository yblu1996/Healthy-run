// 复现"剩余 88 次却提示次数不足"（issue 3）
// 后端 /api/diagnose 的额度判断是 `if (!user || user.quota <= 0) → 402 need_pay`。
// 当 Supabase 读取抖动返回 data=null 时（本机确实在抖：今早有 terminated / fetch failed），
// 有 88 次额度的用户会被当成"次数用完"并弹充值框。
// 做法：把 users 表的读取打桩成"读取失败"，看接口返回 402（bug）还是 500（修复后）。
// 只在额度判断处拦截，run_records 的查询仍走真库；请求在额度判断处就会返回，不会真跑工作流、不扣次数。
process.env.VERCEL = '1'; // 别占用 3000 端口
require('dotenv').config();
const { supabase } = require('../lib/db');
const { signToken } = require('../lib/auth');

const UID = 'e67c98e4-a789-4f9a-aee0-09f650655553'; // 真水无香

(async () => {
  // 拿一张该用户已入库的真实存储桶图片地址（满足 PUBLIC_PREFIX 校验）
  const { data: recs } = await supabase
    .from('run_records')
    .select('images')
    .eq('user_id', UID)
    .order('created_at', { ascending: false })
    .limit(1);
  const images = (recs && recs[0] && recs[0].images) || [];
  if (!images.length) return console.log('没有可用图片地址，无法测试');
  const img = images[0];
  console.log('测试用图片地址前缀:', img.slice(0, 60) + '…');

  // 打桩：users 读取返回 data=null + error（模拟网络/库抖动）
  const realFrom = supabase.from.bind(supabase);
  const fakeChain = {
    select() { return this; }, eq() { return this; }, order() { return this; },
    limit() { return this; }, range() { return this; }, gt() { return this; },
    single() { return Promise.resolve({ data: null, error: { code: 'PGRST116', message: '模拟读取失败' } }); },
    maybeSingle() { return Promise.resolve({ data: null, error: { code: 'PGRST116', message: '模拟读取失败' } }); },
  };
  supabase.from = (table) => (table === 'users' ? fakeChain : realFrom(table));

  const app = require('../api/index.js');
  const server = app.listen(0);
  const port = server.address().port;
  const token = signToken({ id: UID });

  const res = await fetch(`http://127.0.0.1:${port}/api/diagnose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ images: [img], user_text: '测试', goal: 'none' }),
  });
  const body = await res.json();
  console.log('\n=== 接口响应 ===');
  console.log('HTTP', res.status, JSON.stringify(body));
  console.log('\n判定：', body.need_pay
    ? '❌ 触发 402 need_pay —— 有额度的用户被提示"次数不足"（bug 复现）'
    : '✅ 未误报次数不足');

  server.close();
  process.exit(0);
})();
