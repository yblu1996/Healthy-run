// 深挖：真水无香 的额度流水（orders）+ 是否存在重复账号 + 本机服务连通性
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const phone = '18053390911';
  // 同手机号是否注册了多个账号（历史上有重复注册会把额度算错）
  const { data: dups } = await supabase.from('users').select('id, nickname, quota, created_at').eq('phone', phone);
  console.log('=== 同手机号账号数 ===', (dups || []).length);
  for (const u of (dups || [])) console.log(`id=${u.id} nick=${u.nickname} quota=${u.quota} created=${u.created_at}`);

  const uid = 'e67c98e4-a789-4f9a-aee0-09f650655553';

  // 充值/支付流水：quota=87 但注册只送 3 次，看 orders 凑出这个数的过程
  const { data: orders } = await supabase
    .from('orders')
    .select('id, amount, status, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(100);
  console.log('\n=== orders 条数 ===', (orders || []).length);
  for (const o of (orders || []).slice(0, 10)) console.log(`${o.created_at} ${o.amount}元 ${o.status}`);

  // run_records 全量状态分布（failed 多不多 = 工作流稳不稳定）
  const { data: recs } = await supabase
    .from('run_records')
    .select('id, version, status, created_at, summary')
    .eq('user_id', uid)
    .order('created_at', { ascending: false });
  const stat = {};
  for (const r of (recs || [])) stat[r.status] = (stat[r.status] || 0) + 1;
  console.log('\n=== 记录状态分布 ===', JSON.stringify(stat), '总', (recs || []).length);
  for (const r of (recs || []).slice(0, 6)) console.log(`v${r.version} ${r.status} ${r.created_at} summary=${(r.summary || '').slice(0, 60)}`);

  // 直接复刻后端 /api/diagnose 的额度读取语句，看它现在会不会 402
  const { data: user, error } = await supabase
    .from('users')
    .select('quota')
    .eq('id', uid)
    .single();
  console.log('\n=== 复刻 diagnose 额度读取 ===');
  console.log('data =', JSON.stringify(user), ' error =', error ? `${error.code} ${error.message}` : 'null');
  console.log('会触发 402 吗：', !user || user.quota <= 0 ? '是（提示次数不足）' : '否');
})();
