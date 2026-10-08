// 清理浏览器/接口测试期间创建的测试账号（run_records / orders 外键 on delete cascade 自动连带删除）
// 用法：node dev-tests/cleanup-test-users.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TEST_PHONES = ['13800000001', '13800000002', '13900000003', '13900000004', '13900000005', '13900000006'];

(async () => {
  const { data, error } = await supabase
    .from('users')
    .delete()
    .in('phone', TEST_PHONES)
    .select('phone');
  if (error) {
    console.error('清理失败：', error.message);
    process.exit(1);
  }
  console.log('已删除测试账号：', (data || []).map((u) => u.phone).join(', ') || '（无匹配）');
})();
