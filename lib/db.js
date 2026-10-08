const { createClient } = require('@supabase/supabase-js');

// 缺配置宁可拒绝启动，也不要带着 placeholder 运行到一半才报一堆 500
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[启动失败] 未配置 Supabase 环境变量。请复制 .env.example 为 .env 并填写：');
  console.error('  SUPABASE_URL        （Supabase 项目 URL，注意不要带 /rest/v1 后缀）');
  console.error('  SUPABASE_SERVICE_ROLE_KEY（service_role 密钥，只放后端，绝不进前端/仓库）');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = { supabase };
