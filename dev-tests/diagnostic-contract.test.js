const assert = require('node:assert/strict');
const { normalizeSubmission, normalizeRecognition, validateDiagnosis, trendPoint, buildHistoryEvidence } = require('../lib/diagnostic-contract');

const base = { consent_health: true, age: '38', goal: 'health', user_text: '希望更稳地跑步', safety_status: 'none' };
const input = normalizeSubmission({ ...base, race_date: '2027-01-01' }, '2026-09-30');
assert.equal(input.error, undefined);
assert.equal(input.value.race_date, null, '健康目标不能携带旧比赛日期');
assert.equal(input.value.weekly_volume, null, '未知的实际周跑量必须保持未知');
assert.equal(normalizeSubmission({ ...base, consent_health: false }).error, '请先单独同意处理健康数据');
assert.match(normalizeSubmission({ ...base, avg_hr: '412' }).error, /平均心率/);
assert.match(normalizeSubmission({ ...base, safety_status: 'concerning' }).error, /专业人员评估/);
assert.match(normalizeSubmission({ ...base, goal: 'half_marathon', race_date: '2026-02-30' }, '2026-01-01').error, /有效/);
assert.equal(normalizeSubmission({ ...base, goal: 'half_marathon', race_date: '2026-12-01' }, '2026-09-30').value.race_date, '2026-12-01');

const recognition = normalizeRecognition({
  image_type: 'app_screenshot',
  metrics: { distance_km: 6.57, avg_pace_min_per_km: "6'00\"" },
  activities: [
    { date: '2026-09-26', metrics: { distance_km: 7.12, duration_min: 43.2667, avg_heart_rate: 145 }, splits: [{ segment: 1, distance_km: 1, duration_min: 6.05, avg_heart_rate: 138 }], source_image_indices: [1] },
    { date: '2026-09-26', metrics: { distance_km: 7.12, cadence_spm: 190, ground_contact_time_ms: 261 }, source_image_indices: [2, 3] },
    { date: '2026-09-30', metrics: { distance_km: 6.57, duration_min: 39.4667 }, source_image_indices: [4] },
  ],
  period_summaries: [
    { period_type: 'month', period_start: '2026-09-01', period_end: '2026-09-30', distance_km: 112.99, run_count: 16, duration_hours: 11.69, total_calories_kcal: 6936, source_image_indices: [4] },
    { period_type: 'month', period_start: '2026-09-01', period_end: '2026-09-30', distance_km: 112.99, run_count: 16, source_image_indices: [5] },
  ],
}, 5);
assert.equal(recognition.error, undefined);
assert.equal(recognition.value.activities.length, 2, '9 月 26 日的多个页面归为一次跑步');
assert.equal(recognition.value.activities[0].date, '2026-09-30');
assert.equal(recognition.value.activities[0].metrics.avg_heart_rate, null, '9 月 26 日心率不能错归 9 月 30 日');
assert.equal(recognition.value.activities[1].metrics.avg_heart_rate, 145);
assert.equal(recognition.value.activities[1].metrics.ground_contact_time_ms, 261);
assert.equal(recognition.value.activities[1].splits[0].avg_heart_rate, 138);
assert.deepEqual(recognition.value.activities[1].source_image_indices, [1, 2, 3]);
assert.equal(recognition.value.period_summaries.length, 1, '同一 9 月月汇总只存一次');
assert.equal(recognition.value.period_summaries[0].duration_hours, 11.69);
assert.deepEqual(recognition.value.period_summaries[0].source_image_indices, [4, 5]);
assert.equal(recognition.value.metrics.weekly_volume_km, null, '月跑量不应写为周跑量');
assert.equal(recognition.value.weekly_volume_source, null);
const chineseUnits = normalizeRecognition({ image_type: 'app_screenshot', activities: [{
  date: '2026-09-26', metrics: { distance_km: '7.12 公里', duration_min: '00:43:16', avg_heart_rate: '145 次/分钟', cadence_spm: '190 步/分钟', avg_pace_min_per_km: '6′05″/公里' },
}] });
assert.equal(chineseUnits.value.activities[0].metrics.duration_min, 43 + 16 / 60);
assert.equal(chineseUnits.value.activities[0].metrics.avg_heart_rate, 145);
assert.equal(chineseUnits.value.activities[0].metrics.cadence_spm, 190);
assert.equal(chineseUnits.value.data_warnings.length, 0);
const badUnit = normalizeRecognition({ image_type: 'app_screenshot', activities: [{ date: '2026-09-26', metrics: { distance_km: 7.12, avg_heart_rate: '145km' } }] });
assert.equal(badUnit.value.activities[0].metrics.avg_heart_rate, null, '心率不能接受公里单位');
assert.match(badUnit.value.data_warnings.join(' '), /avg_heart_rate/);
const history = buildHistoryEvidence([
  { version: 2, created_at: '2026-09-30', recognition: recognition.value, diagnosis: { summary: '新报告' } },
  { version: 1, created_at: '2026-09-27', recognition: recognition.value, diagnosis: { summary: '旧报告' } },
]);
assert.equal(history.activities.length, 2, '同一活动跨两份报告只传一次给模型');
assert.equal(history.period_summaries.length, 1, '同一月汇总跨两份报告只传一次给模型');
assert.deepEqual(history.reports.map((r) => r.version), [1, 2]);

const wrongLatest = normalizeRecognition({
  image_type: 'app_screenshot', metrics: { distance_km: 7.12, avg_heart_rate: 145 },
  activities: [
    { date: '2026-09-30', metrics: { distance_km: 6.57 } },
    { date: '2026-09-26', metrics: { distance_km: 7.12 } },
  ],
}, 2);
assert.match(wrongLatest.value.data_warnings.join(' '), /最新的跑步不一致/, '旧跑步的心率不能当成最新跑步指标');

const badWeekly = normalizeRecognition({
  image_type: 'app_screenshot', metrics: { distance_km: 6.57, weekly_volume_km: 112.99 },
  period_summaries: [{ period_type: 'month', period_start: '2026-09-01', period_end: '2026-09-30', distance_km: 112.99 }],
}, 2);
assert.equal(badWeekly.value.metrics.weekly_volume_km, null, '周跑量撞上月总量时清空');
assert.match(badWeekly.value.data_warnings.join(' '), /月跑量相同/);
assert.ok(normalizeRecognition({ image_type: 'unclear' }).error);
assert.ok(normalizeRecognition({ image_type: 'app_screenshot', period_summaries: [{ period_type: 'month', period_start: '2026-09-01', period_end: '2026-09-30', distance_km: 112.99 }] }).error, '只有月总量不足以开具个性化计划');
const onlyDatedWeek = normalizeRecognition({
  image_type: 'app_screenshot', metrics: { weekly_volume_km: 112.99 },
  period_summaries: [
    { period_type: 'month', period_start: '2026-09-01', period_end: '2026-09-30', distance_km: 112.99 },
    { period_type: 'week', period_start: '2026-09-21', period_end: '2026-09-27', distance_km: 31.2 },
  ],
});
assert.equal(onlyDatedWeek.value.metrics.weekly_volume_km, 31.2, '有日期的周汇总优先于旧版顶层周跑量');
assert.equal(trendPoint({ recognition: onlyDatedWeek.value }).activity_date, '2026-09-27');
const mislabeledMonth = normalizeRecognition({ image_type: 'app_screenshot', activities: [{ date: '2026-09-30', metrics: { distance_km: 6.57 } }],
  period_summaries: [{ period_type: 'week', period_start: '2026-09-01', period_end: '2026-09-30', distance_km: 112.99 }] });
assert.equal(mislabeledMonth.value.metrics.weekly_volume_km, null, '跨 30 天的统计不能伪装成周汇总');
assert.match(mislabeledMonth.value.data_warnings.join(' '), /日期范围无效/);
const manualWeek = normalizeRecognition({ image_type: 'app_screenshot', metrics: { weekly_volume_km: 112.99 } }, 1, { weekly_volume: 28 });
assert.equal(manualWeek.value.metrics.weekly_volume_km, 28, '用户明确填写的近 7 天跑量可作为证据');
assert.equal(manualWeek.value.weekly_volume_source, 'user_last_7_days');
const copiedMonth = normalizeRecognition({
  image_type: 'app_screenshot', activities: [{ date: '2026-09-30', metrics: { distance_km: 6.57 } }],
  period_summaries: [{ period_type: 'month', period_start: '2026-09-01', period_end: '2026-09-30', distance_km: 112.99 }],
}, 1, { weekly_volume: 112.99 });
assert.equal(copiedMonth.value.metrics.weekly_volume_km, null, '填报值与月总量撞数时应保持未知');
assert.equal(trendPoint({ recognition: { ...copiedMonth.value, user_provided: { weekly_volume_km: 112.99 } } }).weekly_volume_km, null);
assert.equal(trendPoint({ recognition: { metrics: { weekly_volume_km: 112.99 } } }).weekly_volume_km, null, '旧报告中无日期和来源的周跑量不能画为实际');
const sameDayTwice = normalizeRecognition({
  image_type: 'app_screenshot', activities: [
    { date: '2026-09-26', start_time: '06:53', metrics: { distance_km: 7.12 } },
    { date: '2026-09-26', start_time: '18:30', metrics: { distance_km: 7.12 } },
  ],
});
assert.equal(sameDayTwice.value.activities.length, 2, '同日不同时间的两次跑步不能合并');
const oldHistory = buildHistoryEvidence([{ version: 1, created_at: '2026-09-20', recognition: { metrics: { distance_km: 6, weekly_volume_km: 180 } } }]);
assert.equal(oldHistory.reports[0].legacy_metrics_snapshot.distance_km, 6);
assert.equal(oldHistory.reports[0].legacy_metrics_snapshot.weekly_volume_km, undefined, '旧版无时间范围跑量不可传给模型当实测');

const report = require('./tmp-verify-payload.json').diagnosis_result;
assert.equal(validateDiagnosis({ diagnosis_result: report }, 'none').error, undefined);
assert.match(validateDiagnosis({ diagnosis_result: { ...report, plan_8_weeks: report.plan_8_weeks.slice(0, 7) } }, 'none').error, /8 周/);
assert.match(validateDiagnosis({ diagnosis_result: { ...report, race_day_strategy: '比赛日策略' } }, 'health').error, /健康目标/);
// 比赛在 8 周之外：就地修正（删策略、改写比赛周字样），不再整单拒绝
const farRace = validateDiagnosis({ diagnosis_result: { ...report, race_day_strategy: '比赛日策略' } }, 'half_marathon', '2027-01-01', '2026-09-30');
assert.equal(farRace.error, undefined, '远期比赛不再报"不在本次 8 周"');
assert.equal(farRace.value.race_day_strategy, undefined, '远期比赛应移除比赛日策略');
const farRaceWeek = JSON.parse(JSON.stringify(report));
farRaceWeek.plan_8_weeks[7].focus = '基础期末：赛前减量';
const farSanitized = validateDiagnosis({ diagnosis_result: farRaceWeek }, 'half_marathon', '2027-01-01', '2026-09-30');
assert.equal(farSanitized.error, undefined);
assert.equal(farSanitized.value.plan_8_weeks[7].focus.includes('赛前减量'), false, '远期比赛应改写比赛周字样');
assert.equal(farSanitized.value.plan_8_weeks[7].focus.includes('周期化推进'), true);
const earlyRace = JSON.parse(JSON.stringify(report));
earlyRace.race_day_strategy = '保持保守配速，按身体感受完成半马';
assert.match(validateDiagnosis({ diagnosis_result: earlyRace }, 'half_marathon', '2026-10-10', '2026-09-30').error, /比赛安排/);
earlyRace.plan_8_weeks[1].focus = '半马比赛周';
assert.match(validateDiagnosis({ diagnosis_result: earlyRace }, 'half_marathon', '2026-10-10', '2026-09-30').error, /恢复安排/);
earlyRace.plan_8_weeks[2].focus = '赛后恢复与休息';
assert.equal(validateDiagnosis({ diagnosis_result: earlyRace }, 'half_marathon', '2026-10-10', '2026-09-30').error, undefined);
assert.match(validateDiagnosis({ diagnosis_result: { ...report, risk_alert: '请就医评估' } }, 'none').error, /风险警示/);

const trend = trendPoint({ version: 2, created_at: '2026-09-30', recognition: badWeekly.value, diagnosis: report });
assert.equal(trend.weekly_volume_km, null, '缺少实际周跑量时不能用计划代替');
assert.equal(trend.planned_volume_km, Number(report.plan_8_weeks[0].weekly_volume_km));

console.log('diagnostic-contract: all assertions passed');
