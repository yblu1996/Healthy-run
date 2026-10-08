// 创建 UI 验证用测试账号 + 完整模拟诊断记录（用后删除）
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: u, error: ue } = await s
    .from('users')
    .insert({ phone: '13900000007', password_hash: 'x', nickname: 'UI验证', quota: 3 })
    .select('id')
    .single();
  if (ue) return console.log('user-err', ue.message);

  const { error } = await s.from('run_records').insert({
    user_id: u.id,
    version: 1,
    images: [],
    user_text: '测试',
    goal: 'half_marathon',
    race_date: '2027-05-22',
    status: 'done',
    summary: '半马备赛基础期：步频与平衡好，需压日常强度',
    risk_level: '中',
    diagnosis: { risk_alert: '测试健康提醒：左脚趾麻木为一级观察信号，若复现且不缓解立即停跑就医评估。',
      summary: '半马备赛基础期：步频与平衡好，需压日常强度',
      diagnosis: [
        { issue: '日常强度偏高', evidence: '日常心率145偏高', risk: '中', advice: '降速执行轻松跑' },
        { issue: '跑量基线未建立', evidence: '首周完整数据', risk: '低', advice: '保持记录' },
      ],
      progress: { improved: ['低强度有氧执行方向落实'], regressed: [] },
      prev_plan_completion: '前两轮仅给出初步建议，无可量化计划',
      adjustment: '周量先下调至30km起步，随后每周递增不超过10%',
      plan_8_weeks: [
        { week: 1, focus: '减量观察期', weekly_volume_km: 30, runs: [{ day: '周二', type: '轻松跑', detail: '5km 心率140-150' }], note: '脚趾麻木复现立即停跑' },
        { week: 2, focus: '有氧基础', weekly_volume_km: 33, runs: [{ day: '周六', type: '长距离慢跑', detail: '10km' }] },
      ],
      goal_feasibility: { assessment: '16周备赛合理', concerns: ['左脚趾麻木需观察'] },
      race_day_strategy: '前5km压住配速',
      next_check: '4周后重新上传数据',
    },
  });
  console.log(error ? 'rec-err ' + error.message : 'mock-ok');
})();
