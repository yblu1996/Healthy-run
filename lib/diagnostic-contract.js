// Keep untrusted form values and model output out of the report until their
// shape, units and provenance have been checked on the server.
const GOALS = new Set(['none', 'health', 'half_marathon', 'full_marathon']);
const RACE_GOALS = new Set(['half_marathon', 'full_marathon']);
const RUN_YEARS = new Set(['不到 1 年', '1-3 年', '3-5 年', '5 年以上']);
const METRIC_RANGES = {
  distance_km: [0.01, 500], duration_min: [0.1, 4320],
  avg_pace_min_per_km: [2, 30], fastest_pace_min_per_km: [2, 30],
  avg_heart_rate: [40, 220], max_heart_rate: [40, 240],
  cadence_spm: [50, 300], weekly_volume_km: [0, 500],
  elevation_gain_m: [0, 15000], avg_stride_cm: [20, 250],
  ground_contact_time_ms: [100, 600], vertical_oscillation_cm: [1, 25],
  ground_balance_left_pct: [0, 100], ground_balance_right_pct: [0, 100],
  vo2max: [10, 100], aerobic_training_effect: [0, 5],
  anaerobic_training_effect: [0, 5], recovery_hours: [0, 168],
  steps: [0, 200000], avg_speed_kmh: [1, 40],
  total_calories_kcal: [0, 20000], active_calories_kcal: [0, 20000],
};
const METRIC_UNITS = {
  distance_km: /^(?:km|公里)?$/i, weekly_volume_km: /^(?:km|公里)?$/i,
  duration_min: /^(?:min|分钟)?$/i,
  avg_heart_rate: /^(?:bpm|次\/分钟)?$/i, max_heart_rate: /^(?:bpm|次\/分钟)?$/i,
  cadence_spm: /^(?:spm|步\/分钟)?$/i,
  elevation_gain_m: /^(?:m|米)?$/i,
  avg_stride_cm: /^(?:cm|厘米)?$/i,
  ground_contact_time_ms: /^(?:ms|毫秒)?$/i,
  vertical_oscillation_cm: /^(?:cm|厘米)?$/i,
  ground_balance_left_pct: /^%?$/, ground_balance_right_pct: /^%?$/,
  vo2max: /^(?:ml\/kg\/min)?$/i,
  aerobic_training_effect: /^$/, anaerobic_training_effect: /^$/,
  recovery_hours: /^(?:h|小时)?$/i,
  steps: /^步?$/,
  avg_speed_kmh: /^(?:km\/h|公里\/小时)?$/i,
  total_calories_kcal: /^(?:kcal|千卡)?$/i, active_calories_kcal: /^(?:kcal|千卡)?$/i,
};

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function paceMinutes(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim().replace(/\s*\/\s*(?:km|公里)$/i, '').replace(/[′’]/g, "'").replace(/[″“”]/g, '"');
  let minutes;
  let seconds;
  let match = /^(\d{1,2})[':](\d{1,2})"?$/.exec(raw);
  if (match) {
    minutes = Number(match[1]); seconds = Number(match[2]);
  } else if (/^\d{3,4}$/.test(raw)) {
    minutes = Number(raw.slice(0, -2)); seconds = Number(raw.slice(-2));
  } else if (/^\d{1,2}(?:\.\d+)?$/.test(raw)) {
    const decimal = Number(raw);
    minutes = Math.floor(decimal); seconds = Math.round((decimal - minutes) * 60);
  } else return null;
  if (seconds < 0 || seconds >= 60) return null;
  const valueMinutes = minutes + seconds / 60;
  return valueMinutes >= 2 && valueMinutes <= 30 ? valueMinutes : null;
}

function paceText(value) {
  const n = paceMinutes(value);
  if (n == null) return null;
  const totalSeconds = Math.round(n * 60);
  return `${Math.floor(totalSeconds / 60)}'${String(totalSeconds % 60).padStart(2, '0')}"/km`;
}

function normalizeSubmission(body, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Hong_Kong' })) {
  if (!object(body)) return { error: '提交内容格式无效' };
  if (body.consent_health !== true) return { error: '请先单独同意处理健康数据' };
  if (typeof body.user_text !== 'undefined' && typeof body.user_text !== 'string') return { error: '问题描述格式无效' };
  const userText = (body.user_text || '').trim();
  if (userText.length > 2000) return { error: '问题描述不能超过 2000 字' };

  const goal = body.goal == null || body.goal === '' ? 'none' : body.goal;
  if (!GOALS.has(goal)) return { error: '跑步目标无效' };
  const age = Number(body.age);
  if (!Number.isInteger(age) || age < 14 || age > 100) return { error: '年龄请填 14~100 之间的整数' };

  const optionalNumber = (key, min, max, integer, label) => {
    const raw = body[key];
    if (raw == null || String(raw).trim() === '') return { value: null };
    if (typeof raw !== 'number' && typeof raw !== 'string') return { error: `${label}格式无效` };
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      return { error: `${label}请填 ${min}~${max} 之间的${integer ? '整数' : '数字'}` };
    }
    return { value };
  };
  const numeric = {};
  for (const [key, min, max, integer, label] of [
    ['height', 100, 250, false, '身高'], ['weight', 20, 300, false, '体重'],
    ['weekly_volume', 0, 500, false, '最近 7 天跑量'],
    ['avg_hr', 40, 220, true, '平均心率'], ['cadence', 50, 300, true, '步频'],
  ]) {
    const result = optionalNumber(key, min, max, integer, label);
    if (result.error) return result;
    numeric[key] = result.value;
  }
  const gender = body.gender == null || body.gender === '' ? null : body.gender;
  if (gender != null && !['男', '女'].includes(gender)) return { error: '性别选项无效' };
  const runYears = body.run_years == null || body.run_years === '' ? null : body.run_years;
  if (runYears != null && !RUN_YEARS.has(runYears)) return { error: '跑龄选项无效' };
  const avgPace = body.avg_pace == null || body.avg_pace === '' ? null : paceText(body.avg_pace);
  if (body.avg_pace && !avgPace) return { error: '配速格式不正确，请输入如 6′30″/km' };

  let raceDate = null;
  if (RACE_GOALS.has(goal)) {
    if (!validDate(body.race_date)) return { error: '请选择完整且有效的比赛日期' };
    if (body.race_date <= today) return { error: '比赛日期需晚于今天' };
    raceDate = body.race_date;
  }
  const safetyStatus = body.safety_status || 'unknown';
  if (!['none', 'unknown', 'concerning'].includes(safetyStatus)) return { error: '运动风险选项无效' };
  if (safetyStatus === 'concerning') {
    return { error: '当前描述的警示症状需要先由专业人员评估；本服务暂不生成训练计划，也不会扣除次数', status: 422 };
  }

  return { value: {
    user_text: userText, goal, race_date: raceDate, gender, age,
    run_years: runYears, avg_pace: avgPace, safety_status: safetyStatus,
    ...numeric,
  } };
}

function metricNumber(key, value, warnings) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^(?:未知|未识别|无|N\/A|—|-)$/i.test(value.trim())) return null;
  const range = METRIC_RANGES[key];
  if (!range) return null;
  let n;
  if (key.includes('pace')) n = paceMinutes(value);
  else if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const raw = value.trim();
    const clock = key === 'duration_min' && /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(raw);
    if (clock && Number(clock[3]) < 60 && (clock[1] == null || Number(clock[2]) < 60)) {
      n = Number(clock[1] || 0) * 60 + Number(clock[2]) + Number(clock[3]) / 60;
    } else {
      const match = /^(\d+(?:\.\d+)?)\s*(.*?)$/.exec(raw);
      if (match && METRIC_UNITS[key].test(match[2])) n = Number(match[1]);
    }
  }
  if (!Number.isFinite(n) || n < range[0] || n > range[1]) {
    warnings.push(`${key} 的数值或单位无法确认，已忽略`);
    return null;
  }
  return n;
}

function cleanMetrics(input, warnings) {
  const src = object(input) || {};
  const metrics = {};
  for (const key of Object.keys(METRIC_RANGES)) metrics[key] = metricNumber(key, src[key], warnings);
  return metrics;
}

function imageIndices(value, imageCount) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((n) => Number.isInteger(n) && n >= 1 && n <= imageCount))].sort((a, b) => a - b);
}

function cleanSplits(value, warnings) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value.slice(0, 200)) {
    const split = object(item);
    if (!split) continue;
    const segment = Number(split.segment);
    if (!Number.isInteger(segment) || segment < 1 || segment > 200) continue;
    const metrics = {};
    for (const key of ['distance_km', 'duration_min', 'avg_pace_min_per_km', 'avg_heart_rate', 'cadence_spm']) {
      metrics[key] = metricNumber(key, split[key], warnings);
    }
    if (Object.values(metrics).every((v) => v == null)) continue;
    const old = result.find((s) => s.segment === segment);
    if (old) {
      for (const [key, v] of Object.entries(metrics)) if (old[key] == null) old[key] = v;
    } else result.push({ segment, ...metrics });
  }
  return result.sort((a, b) => a.segment - b.segment);
}

function comparable(a, b) {
  if (!a.date || a.date !== b.date) return false;
  if (a.start_time && b.start_time && a.start_time !== b.start_time) return false;
  const d1 = a.metrics.distance_km; const d2 = b.metrics.distance_km;
  if (d1 == null || d2 == null || Math.abs(d1 - d2) > 0.02) return false;
  const t1 = a.metrics.duration_min; const t2 = b.metrics.duration_min;
  return t1 == null || t2 == null || Math.abs(t1 - t2) <= 1;
}

function normalizeRecognition(raw, imageCount = 0, manual = {}) {
  if (!object(raw)) return { error: '识图结果缺失或格式无效' };
  if (raw.image_type === 'unclear') return { error: '图片内容无法可靠识别，请上传更清晰的截图' };
  const warnings = [];
  const activities = [];
  const incoming = Array.isArray(raw.activities) ? raw.activities : (Array.isArray(raw.runs) ? raw.runs : []);
  for (const item of incoming.slice(0, 100)) {
    const r = object(item);
    if (!r) continue;
    const metrics = cleanMetrics(object(r.metrics) || r, warnings);
    metrics.weekly_volume_km = null; // 单次活动绝不承载周/月汇总
    if (!Object.values(metrics).some((v) => v != null)) continue;
    const date = validDate(r.date) ? r.date : null;
    const startTime = typeof r.start_time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.start_time) ? r.start_time : null;
    const candidate = { date, start_time: startTime, metrics, splits: cleanSplits(r.splits, warnings), source_image_indices: imageIndices(r.source_image_indices, imageCount) };
    const old = activities.find((a) => comparable(a, candidate));
    if (old) {
      for (const [key, value] of Object.entries(metrics)) {
        if (value == null) continue;
        if (old.metrics[key] == null) old.metrics[key] = value;
        else if (Math.abs(old.metrics[key] - value) > 0.02) warnings.push(`${date} 跑步的 ${key} 在截图间不一致，请核对`);
      }
      old.source_image_indices = [...new Set([...old.source_image_indices, ...candidate.source_image_indices])].sort((a, b) => a - b);
      for (const split of candidate.splits) {
        const existing = old.splits.find((s) => s.segment === split.segment);
        if (!existing) old.splits.push(split);
        else for (const [key, value] of Object.entries(split)) if (key !== 'segment' && existing[key] == null) existing[key] = value;
      }
      old.splits.sort((a, b) => a.segment - b.segment);
    } else activities.push(candidate);
  }
  activities.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.start_time || '').localeCompare(a.start_time || ''));

  const legacyMetrics = cleanMetrics(raw.metrics, warnings);
  if (Object.values(legacyMetrics).some((v) => v != null)) {
    const matches = activities.filter((a) => {
      const d = legacyMetrics.distance_km;
      if (d == null || a.metrics.distance_km == null || Math.abs(d - a.metrics.distance_km) > 0.02) return false;
      return legacyMetrics.duration_min == null || a.metrics.duration_min == null
        || Math.abs(legacyMetrics.duration_min - a.metrics.duration_min) <= 1;
    });
    if (matches.length === 1) {
      const match = matches[0];
      if (activities[0] && activities[0].date && match.date && activities[0].date > match.date) {
        warnings.push('顶层完整指标与日期最新的跑步不一致，请核对图片日期');
      }
      for (const [key, value] of Object.entries(legacyMetrics)) if (value != null && match.metrics[key] == null) match.metrics[key] = value;
    } else if (activities.length) {
      warnings.push('顶层完整指标无法对应到活动列表中的日期，未将其归给任意活动');
    } else if (legacyMetrics.distance_km != null || legacyMetrics.duration_min != null || legacyMetrics.avg_pace_min_per_km != null) {
      activities.push({ date: null, start_time: null, metrics: { ...legacyMetrics, weekly_volume_km: null }, splits: [], source_image_indices: [] });
    }
  }

  const periodSummaries = [];
  for (const item of (Array.isArray(raw.period_summaries) ? raw.period_summaries : []).slice(0, 60)) {
    const p = object(item);
    if (!p || !['week', 'month'].includes(p.period_type) || !validDate(p.period_start) || !validDate(p.period_end) || p.period_end < p.period_start) continue;
    const spanDays = (Date.parse(p.period_end) - Date.parse(p.period_start)) / 86400000 + 1;
    if ((p.period_type === 'week' && spanDays > 7)
      || (p.period_type === 'month' && (p.period_start.slice(8) !== '01' || p.period_start.slice(0, 7) !== p.period_end.slice(0, 7)))) {
      warnings.push(`${p.period_start} 的${p.period_type === 'week' ? '周' : '月'}汇总日期范围无效，已忽略`);
      continue;
    }
    const distance = p.distance_km == null ? null : Number(p.distance_km);
    if (distance != null && (!Number.isFinite(distance) || distance < 0 || distance > (p.period_type === 'month' ? 3000 : 500))) {
      warnings.push(`${p.period_start} 汇总跑量超出合理范围，已忽略`);
      continue;
    }
    const runs = p.run_count == null ? null : Number(p.run_count);
    const durationHours = p.duration_hours == null ? null : Number(p.duration_hours);
    const calories = p.total_calories_kcal == null ? null : Number(p.total_calories_kcal);
    const summary = {
      period_type: p.period_type, period_start: p.period_start, period_end: p.period_end,
      distance_km: distance, run_count: Number.isInteger(runs) && runs >= 0 && runs <= 500 ? runs : null,
      duration_hours: Number.isFinite(durationHours) && durationHours >= 0 && durationHours <= 744 ? durationHours : null,
      total_calories_kcal: Number.isFinite(calories) && calories >= 0 && calories <= 100000 ? calories : null,
      source_image_indices: imageIndices(p.source_image_indices, imageCount),
    };
    const old = periodSummaries.find((s) => s.period_type === summary.period_type && s.period_start === summary.period_start && s.period_end === summary.period_end);
    if (old) {
      if (old.distance_km != null && summary.distance_km != null && Math.abs(old.distance_km - summary.distance_km) > 0.02) warnings.push(`${summary.period_start} 汇总数值冲突，请核对`);
      else if (old.distance_km == null) old.distance_km = summary.distance_km;
      if (old.run_count == null) old.run_count = summary.run_count;
      if (old.duration_hours == null) old.duration_hours = summary.duration_hours;
      if (old.total_calories_kcal == null) old.total_calories_kcal = summary.total_calories_kcal;
      old.source_image_indices = [...new Set([...old.source_image_indices, ...summary.source_image_indices])].sort((a, b) => a - b);
    } else periodSummaries.push(summary);
  }
  const latest = activities.find((a) => a.date) || activities[0];
  const metrics = latest ? { ...latest.metrics } : legacyMetrics;
  // The old top-level field has no time range or provenance. Only an explicitly
  // dated week summary or the user's labelled last-7-days answer is reliable.
  const latestWeek = periodSummaries.filter((p) => p.period_type === 'week' && p.distance_km != null)
    .sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
  const manualWeekly = manual.weekly_volume == null || manual.weekly_volume === '' ? null : Number(manual.weekly_volume);
  let trustedWeekly = Number.isFinite(manualWeekly) && manualWeekly >= 0 && manualWeekly <= 500
    ? manualWeekly : (latestWeek ? latestWeek.distance_km : null);
  let weeklyVolumeSource = Number.isFinite(manualWeekly) && manualWeekly >= 0 && manualWeekly <= 500
    ? 'user_last_7_days' : (latestWeek ? 'dated_week_summary' : null);
  if (legacyMetrics.weekly_volume_km != null && periodSummaries.some((p) => p.period_type === 'month' && p.distance_km != null && Math.abs(p.distance_km - legacyMetrics.weekly_volume_km) <= 0.02)) {
    warnings.push('近 7 天跑量与月跑量相同，来源无法区分，已清空近 7 天跑量');
  }
  if (weeklyVolumeSource === 'user_last_7_days' && periodSummaries.some((p) => p.period_type === 'month' && p.distance_km != null && Math.abs(p.distance_km - trustedWeekly) <= 0.02)) {
    warnings.push('填报的近 7 天跑量与月跑量完全相同，请核实时间范围；本次不采用该周跑量');
    trustedWeekly = null;
    weeklyVolumeSource = null;
  }
  metrics.weekly_volume_km = trustedWeekly;
  const hasEvidence = activities.some((a) => a.metrics.distance_km != null || a.metrics.duration_min != null)
    || metrics.weekly_volume_km != null
    || (manual.weekly_volume != null && manual.avg_pace != null);
  if (!hasEvidence) return { error: '缺少单次跑步或可靠近 7 天训练量，暂无法制定个人 8 周计划；请补充跑步详情或填写已知周跑量与配速' };
  return { value: {
    ...raw, contract_version: 2, metrics, activities, period_summaries: periodSummaries,
    weekly_volume_source: weeklyVolumeSource,
    data_warnings: [...new Set(warnings)],
  } };
}

function validateDiagnosis(output, goal, raceDate = null, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Hong_Kong' })) {
  const diagnosis = object(output && output.diagnosis_result) || object(output);
  if (!diagnosis || typeof diagnosis.summary !== 'string' || !diagnosis.summary.trim() || diagnosis.summary.length > 2000) return { error: '报告缺少有效总评' };
  const issues = diagnosis.diagnosis;
  if (!Array.isArray(issues) || issues.length > 30 || issues.some((it) => !object(it) || !['issue', 'evidence', 'advice'].every((key) => typeof it[key] === 'string' && it[key].trim() && it[key].length <= 2000) || !['高', '中', '低'].includes(it.risk))) {
    return { error: '问题诊断缺少可核对的依据或建议' };
  }
  const plan = Array.isArray(diagnosis.plan_8_weeks) ? diagnosis.plan_8_weeks : diagnosis.training_plan;
  if (!Array.isArray(plan) || plan.length !== 8) return { error: '训练计划必须恰好包含 8 周' };
  for (let i = 0; i < plan.length; i++) {
    const week = object(plan[i]);
    if (!week || Number(week.week) !== i + 1 || typeof week.focus !== 'string' || !week.focus.trim() || week.focus.length > 500) return { error: `第 ${i + 1} 周的编号或重点无效` };
    const volume = Number(week.weekly_volume_km);
    if (week.weekly_volume_km == null || week.weekly_volume_km === '' || !Number.isFinite(volume) || volume < 0 || volume > 500) return { error: `第 ${i + 1} 周的计划跑量无效` };
    if (!Array.isArray(week.runs) || week.runs.length < 1 || week.runs.length > 14 || week.runs.some((r) => !object(r) || !['day', 'type', 'detail'].every((k) => typeof r[k] === 'string' && r[k].trim() && r[k].length <= 1000))) {
      return { error: `第 ${i + 1} 周缺少可执行的训练安排` };
    }
  }
  if (!RACE_GOALS.has(goal) && diagnosis.race_day_strategy) return { error: '健康目标不应包含比赛日策略' };
  if (!RACE_GOALS.has(goal) && plan.some((week) => /比赛周|赛前减量/.test(week.focus))) return { error: '健康目标不应包含比赛周' };
  const daysToRace = raceDate && validDate(raceDate) ? (Date.parse(raceDate) - Date.parse(today)) / 86400000 : null;
  // 比赛在 8 周之外：模型偶尔仍会输出比赛策略/比赛周（提示词已禁止，这里兜底就地修正）。
  // 不再整单拒绝——拒绝等于用户白等 3 分钟且一无所获，还会误以为是自己把日期填错了。
  if (RACE_GOALS.has(goal) && daysToRace != null && daysToRace > 56) {
    let sanitized = false;
    if (diagnosis.race_day_strategy) {
      delete diagnosis.race_day_strategy;
      sanitized = true;
    }
    plan.forEach((week) => {
      if (/比赛周|赛前减量/.test(week.focus)) {
        week.focus = week.focus.replace(/比赛周|赛前减量/g, '周期化推进').replace(/[：:，,、\s]+$/, '').trim();
        sanitized = true;
      }
    });
    if (sanitized) console.log('[diagnosis] 比赛日期在本次 8 周之外，已自动移除模型输出的比赛相关内容');
  }
  if (RACE_GOALS.has(goal) && daysToRace != null && daysToRace > 0 && daysToRace <= 56) {
    if (typeof diagnosis.race_day_strategy !== 'string' || !diagnosis.race_day_strategy.trim()) {
      return { error: '比赛在本次 8 周内，需要对应的比赛日策略' };
    }
    const raceWeekIndex = Math.ceil(daysToRace / 7) - 1;
    const raceWeek = plan[raceWeekIndex];
    const raceText = `${raceWeek.focus} ${raceWeek.runs.map((r) => `${r.type} ${r.detail}`).join(' ')}`;
    if (!/比赛|半马|全马|赛事|参赛/.test(raceText)) {
      return { error: `比赛日期对应第 ${raceWeekIndex + 1} 周，但该周缺少比赛安排` };
    }
    if (raceWeekIndex < 7) {
      const next = plan[raceWeekIndex + 1];
      if (!/赛后|恢复|休整|减量|调整|休息/.test(next.focus)) {
        return { error: '比赛后第 1 周缺少恢复安排' };
      }
    }
  }
  if (typeof diagnosis.risk_alert === 'string' && /就医|暂停跑步|停止跑步/.test(diagnosis.risk_alert)) {
    const firstWeek = plan[0].runs;
    if (firstWeek.some((r) => !/全休|休息|就医|评估/.test(r.type))) return { error: '风险警示与第 1 周训练安排冲突' };
  }
  const progress = object(diagnosis.progress) || {};
  // The product does not collect completed sessions. A model cannot infer
  // adherence from earlier reports, even though each submission gets a new plan.
  return { value: { ...diagnosis, progress: { ...progress, prev_plan_completion: null }, plan_8_weeks: plan } };
}

function trendPoint(record) {
  const recognition = object(record.recognition) || {};
  const diagnosis = object(record.diagnosis) || {};
  const metrics = object(recognition.metrics) || {};
  const supplied = object(recognition.user_provided) || {};
  const summaries = Array.isArray(recognition.period_summaries) ? recognition.period_summaries : [];
  const latestWeek = summaries.filter((p) => p && p.period_type === 'week' && p.distance_km != null)
    .sort((a, b) => String(b.period_end || '').localeCompare(String(a.period_end || '')))[0];
  const suppliedWeekly = supplied.weekly_volume_km == null ? null : Number(supplied.weekly_volume_km);
  const suppliedCollidesWithMonth = summaries.some((p) => p && p.period_type === 'month' && p.distance_km != null
    && suppliedWeekly != null && Math.abs(Number(p.distance_km) - suppliedWeekly) <= 0.02);
  const hasSuppliedWeek = Number.isFinite(suppliedWeekly) && suppliedWeekly >= 0 && suppliedWeekly <= 500
    && !suppliedCollidesWithMonth;
  const legacyTrusted = ['user_last_7_days', 'dated_week_summary'].includes(recognition.weekly_volume_source)
    ? metrics.weekly_volume_km : null;
  const weeklyValue = hasSuppliedWeek
    ? suppliedWeekly : (latestWeek ? latestWeek.distance_km : legacyTrusted);
  const weekly = Number(weeklyValue);
  const heart = Number(metrics.avg_heart_rate);
  const plan = Array.isArray(diagnosis.plan_8_weeks) ? diagnosis.plan_8_weeks : [];
  const planned = plan[0] && Number(plan[0].weekly_volume_km);
  return {
    version: record.version, date: record.created_at,
    activity_date: hasSuppliedWeek ? String(record.created_at || '').slice(0, 10)
      : latestWeek ? latestWeek.period_end
      : ((Array.isArray(recognition.activities) && recognition.activities[0] && recognition.activities[0].date) || null),
    weekly_volume_source: weeklyValue == null ? null
      : (hasSuppliedWeek
        ? 'user_last_7_days' : (latestWeek ? 'dated_week_summary' : recognition.weekly_volume_source)),
    weekly_volume_km: weeklyValue != null && Number.isFinite(weekly) ? weekly : null,
    planned_volume_km: plan.length && Number.isFinite(planned) ? planned : null,
    avg_heart_rate: metrics.avg_heart_rate != null && Number.isFinite(heart) ? heart : null,
  };
}

function buildHistoryEvidence(rows) {
  const reports = [];
  const activities = [];
  const periodSummaries = [];
  // Prefer the most recent extraction when the same screenshot was submitted again.
  for (const row of rows || []) {
    const rec = object(row.recognition) || {};
    const diag = object(row.diagnosis) || {};
    reports.push({
      version: row.version, submitted_at: row.created_at,
      summary: typeof diag.summary === 'string' ? diag.summary : null,
      user_provided: object(rec.user_provided) || null,
      // Older reports had only a flat metrics object. Preserve it as a
      // snapshot, never as another dated activity or volume to be added.
      legacy_metrics_snapshot: !Array.isArray(rec.activities) && !Array.isArray(rec.runs)
        ? Object.fromEntries(Object.entries(cleanMetrics(rec.metrics, []))
          .filter(([key, value]) => key !== 'weekly_volume_km' && value != null)) : null,
    });
    const sourceActivities = Array.isArray(rec.activities) ? rec.activities : (Array.isArray(rec.runs) ? rec.runs : []);
    for (const raw of sourceActivities) {
      const item = object(raw);
      if (!item || !validDate(item.date)) continue;
      const metrics = object(item.metrics) || item;
      const distance = Number(metrics.distance_km);
      if (!Number.isFinite(distance) || distance <= 0) continue;
      const candidate = { date: item.date, start_time: item.start_time || null, metrics: { ...metrics }, source_report_versions: [row.version] };
      const existing = activities.find((a) => comparable(a, candidate));
      if (existing) {
        existing.source_report_versions.push(row.version);
        for (const [key, value] of Object.entries(metrics)) if (existing.metrics[key] == null && value != null) existing.metrics[key] = value;
      } else activities.push(candidate);
    }
    for (const raw of (Array.isArray(rec.period_summaries) ? rec.period_summaries : [])) {
      const p = object(raw);
      if (!p || !['week', 'month'].includes(p.period_type) || !validDate(p.period_start) || !validDate(p.period_end)) continue;
      const existing = periodSummaries.find((s) => s.period_type === p.period_type && s.period_start === p.period_start && s.period_end === p.period_end);
      if (existing) existing.source_report_versions.push(row.version);
      else periodSummaries.push({
        period_type: p.period_type, period_start: p.period_start, period_end: p.period_end,
        distance_km: p.distance_km ?? null, run_count: p.run_count ?? null,
        duration_hours: p.duration_hours ?? null, source_report_versions: [row.version],
      });
    }
  }
  activities.sort((a, b) => b.date.localeCompare(a.date));
  periodSummaries.sort((a, b) => b.period_end.localeCompare(a.period_end));
  return { reports: reports.reverse(), activities: activities.slice(0, 40), period_summaries: periodSummaries.slice(0, 12) };
}

module.exports = { normalizeSubmission, normalizeRecognition, validateDiagnosis, trendPoint, buildHistoryEvidence, paceMinutes, validDate };
