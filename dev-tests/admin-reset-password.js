// 管理员应急重置密码：用户忘记密码且密保答案也忘记/账号未设密保时，核实身份后用此脚本重置。
// 用法：node dev-tests/admin-reset-password.js <手机号> <新密码(至少6位)>
// 凭据走 .env 的 SUPABASE_SERVICE_ROLE_KEY，不经过应用接口，因此没有限流/锁定干扰。
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const phone = process.argv[2];
const newPassword = process.argv[3];
if (!/^1\d{10}$/.test(phone || '') || !newPassword || newPassword.length < 6) {
  console.log('用法：node dev-tests/admin-reset-password.js <手机号> <新密码(至少6位)>');
  process.exit(1);
}

(async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: user, error } = await sb
    .from('users')
    .select('id, phone, nickname, security_question')
    .eq('phone', phone)
    .maybeSingle();
  if (error) return console.log('查询失败:', error.message);
  if (!user) return console.log('该手机号未注册');

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const { error: upErr } = await sb
    .from('users')
    .update({ password_hash: passwordHash })
    .eq('id', user.id);
  if (upErr) return console.log('重置失败:', upErr.message);
  console.log(`已重置 ${user.nickname || ''} (${user.phone}) 的密码。该账号${user.security_question ? '已设置密保问题' : '未设置密保问题，提醒用户登录后到首页「密保问题」补设'}。`);
})();
