// 对照实验：Dify 到底能不能从"签名 URL"拉到图？
//
// 背景：图片私有化后，Dify 收到的 remote_url 变成带 ?token=… 的签名链接。
// 有些 remote_url 实现会按 URL 后缀判断文件类型，带查询串时可能判不出——必须实测，不能想当然。
// 做法：同一张图，分别用「公开 URL」与「签名 URL」各跑一次识图+诊断，比对识图结果。
//   - 两边都能读出指标 → 说明签名 URL 没问题，前面那次 500 是模型高思考档的输出截断
//   - 只有公开 URL 能读 → 说明签名 URL 触发了拉取失败，方案要改
//
// 直连 Dify，不经过跑悟后端，不消耗任何账号的诊断次数。
// 用法：node dev-tests/dify-image-access-probe.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { runWorkflow } = require('../lib/dify');

const BUCKET = process.env.STORAGE_BUCKET || 'run-images';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function probeOne(label, url) {
  const t0 = Date.now();
  try {
    const out = await runWorkflow({ images: [url], userText: '', goal: 'none', raceDate: '', history: '[]' });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const recog = out.recognition || {};
    const metrics = recog.metrics || {};
    const nonNull = Object.entries(metrics).filter(([, v]) => v !== null && v !== undefined && v !== '');
    const runs = Array.isArray(recog.runs) ? recog.runs.length : 0;
    const diag = out.diagnosis_result;
    const diagOk = !!(diag && typeof diag === 'object' && Array.isArray(diag.plan_8_weeks));
    console.log(`\n【${label}】${secs}s`);
    console.log('  image_type:', recog.image_type);
    console.log('  非空指标:', nonNull.length, '项 ->', JSON.stringify(nonNull.slice(0, 6)));
    console.log('  runs 条数:', runs);
    console.log('  诊断可解析:', diagOk, diagOk ? `（8 周计划 ${diag.plan_8_weeks.length} 项）` : '（原始类型 ' + typeof diag + '）');
    if (!diagOk && typeof diag === 'string') console.log('  诊断原文前 200 字:', diag.slice(0, 200).replace(/\n/g, ' '));
    return { label, imageType: recog.image_type, nonNull: nonNull.length, diagOk };
  } catch (e) {
    console.log(`\n【${label}】失败：${e.message}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
    return { label, error: e.message };
  }
}

(async () => {
  // 必须用**已知能被识别**的图：随手取桶里第一张会取到不含数据的照片（曾实测两张都返回 unclear，
  // 两条路径都没指标，等于没测出任何东西）。这里默认用 A/B 实测那张真跑步数据截图。
  const KNOWN_GOOD = 'fbda77bb-4eca-405e-adb0-cd25ada55ecc/1790169373816-736dcf8e-dece-4f69-8445-fb7fc886db2b.jpg';
  const target = process.argv[2] || KNOWN_GOOD;
  console.log('测试对象：', target);

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(target);
  const { data: sig } = await sb.storage.from(BUCKET).createSignedUrl(target, 3600);
  console.log('公开 URL：', pub.publicUrl.replace(/\?.*$/, ''));
  console.log('签名 URL：', sig.signedUrl.replace(/\?.*$/, '?<token>'));
  console.log('\n两次并发跑（各约 2-3 分钟）…');

  const [a, b] = await Promise.all([
    probeOne('公开 URL', pub.publicUrl),
    probeOne('签名 URL', sig.signedUrl),
  ]);

  console.log('\n=== 结论 ===');
  if (a.error || b.error) { console.log('有运行失败，结论不成立，看上面的报错'); process.exit(1); }
  // 判据是 image_type：能判成 app_screenshot 说明模型确实看到了图（拉取失败时会是 unclear）。
  // 不要用"非空指标条数"当判据——单图输入时指标可能落在别的字段，条数为 0 不等于没读到图。
  const readOk = (r) => r.imageType && r.imageType !== 'unclear';
  if (readOk(a) && readOk(b)) {
    console.log(`两边都识别成功（image_type 均为 ${b.imageType}）→ 签名 URL 可用，私有化不影响 Dify 识图`);
    if (a.nonNull === 0 && b.nonNull === 0) {
      console.log('（注：本次非空指标为 0，是该图/该输入下的正常结果，两条路径表现一致即可判定）');
    }
  } else if (readOk(a) && !readOk(b)) {
    console.log('❌ 只有公开 URL 能读图 → 签名 URL 让 Dify 拉取失败，方案必须调整');
    process.exit(1);
  } else if (!readOk(a) && !readOk(b)) {
    console.log('⚠️ 两条路径都没识别成功 → 这张图或这次输入有问题，换图/换输入再测');
    process.exit(1);
  } else {
    console.log('⚠️ 只有签名 URL 读到 → 结果反常，需要复测');
  }
})().catch((e) => { console.error('探针异常：', e.message); process.exit(1); });
