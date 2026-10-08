// 排查"剩余次数 88 但提示次数不足"：看该用户的面板真实状态
// 只输出诊断需要的数据，不打印任何密钥
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // 1) 找到"真水无香"（昵称或手机号均可），同时看是否有重复账号
  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id, phone, nickname, quota, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (uErr) return console.error('读取用户失败：', uErr.message);

  const hit = users.filter((u) => (u.nickname || '').includes('真水无香'));
  const show = hit.length ? hit : users;
  console.log('=== 用户（最近 50 条，命中真水无香则只显示命中）===');
  for (const u of show) {
    console.log(`id=${u.id} phone=${u.phone} nick=${u.nickname} quota=${JSON.stringify(u.quota)} (${typeof u.quota}) created=${u.created_at}`);
  }
  if (!hit.length) console.log('（未找到昵称含"真水无香"的用户，上面列出全部最近用户供核对）');

  // 3) 命中用户的待处理记录（pending 堆积会让新提交被 400 拦下，而不是 402）
  if (hit.length) {
    for (const u of hit) {
      const { data: pend } = await supabase
        .from('run_records')
        .select('id, version, status, created_at')
        .eq('user_id', u.id)
        .order('created_at', { ascending: false })
        .limit(10);
      console.log(`\n=== ${u.nickname} 最近 10 条记录 ===`);
      for (const r of (pend || [])) console.log(`v${r.version} ${r.status} ${r.created_at}`);
    }
  }
})();
