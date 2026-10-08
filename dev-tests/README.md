# dev-tests —— 本地开发与运维脚本

**只有本目录根下的脚本是活跃的**，随用随跑；`archive/` 里是历史一次性产物，仅供查阅。

约定：

- 需要 Dify 控制台会话的脚本，先跑 `dify-login.js` 刷新凭据。
- 需要连线上库的脚本读仓库根 `.env`（Supabase / JWT），**不要把密钥写进代码**。
- 一律从**仓库根**执行：`node dev-tests/<脚本名>`。

## Dify 工作流运维（AI 大脑，8180）

| 脚本 | 用途 |
| --- | --- |
| `dify-login.js` | 登录控制台，刷新 `.dify-cookie.txt` + `.dify-csrf.txt`（其他控制台脚本的前置） |
| `dify-perf-probe.js` | **首选**：SSE 全事件打点，实测每个节点耗时 / token / 输出大小，定位慢在哪一步 |
| `dify-run-timings.js` | 拉取近期运行记录，按节点汇总耗时 |
| `dify-tune-diag-node.js` | 读 / 改「诊断计划」节点模型参数（`--show`、`--set '{...}'`，可加 `--publish`） |
| `dify-apply-reasoning.js` | 一键把两个 LLM 节点的思考强度改成 low / high 并发布 |
| `dify-fix-diag-prompt.js` | 消歧「诊断计划」提示词的输出格式要求（拆成基础字段 + 备战额外字段） |
| `dify-expand-metrics.js` | **提示词扩展（幂等）**：识图 metrics 白名单 8 → 17 字段 + runs 契约，诊断节点「全休/力量」改硬要求；`--dry` 预览，`--publish` 保存并发布 |
| `dify-no-missing-hint.js` | **提示词扩展（幂等）**：禁用"数据不足/建议补充"措辞 + JSON 值内禁用英文裸引号 + plan_8_weeks 正好 8 项；`--dry` / `--publish` |
| `dify-live-test.js` | 真实全链路：库里图片 → Dify → 用生产 `lib/dify.js` 解析输出 |
| `dify-unit-test.js` | 单元验证：mock SSE 流，测 `runWorkflow` 的解析 / 解包 / 错误路径 |
| `dify-timeout-test.js` | 验证长耗时请求不被总超时误杀（空闲超时 + 硬上限） |
| `dify-ab-matrix.js` | **思考强度实测**：对同一份固定输入依次跑 low / high / max，记录各节点耗时与原始输出，结束自动恢复**线上档位**（默认 `high`，可用 `PROD_EFFORT=low` 覆盖）。支持 `--input <夹具>` `--tag <后缀>`（如单图稀疏输入）。**夹具里的图片地址会在开跑前按对象路径重新签名**（桶已私有，夹具里的旧公开 URL 全部失效，不重签会静默拉到空图、两组都输出 unclear） |
| `dify-ab-compare.js` | 对比三档输出的质量（识图指标正确率、诊断字段完整性、计划结构），与上面配套 |
| `ab-diff-low-high.js` | low / high 同一输入的**报告内容逐项对照**（诊断项、周跑量、硬要求达标、缺失类措辞扫描） |
| `dify-image-access-probe.js` | **对照实验**：同一张图分别用「公开 URL」与「签名 URL」跑 Dify，比对识图结果，用来确认私有化后签名 URL 不会让 Dify 拉不到图。判据是 `image_type`（不是指标条数），默认用已知可识别的图，可传对象路径覆盖 |
| `pg-nodes.sql` / `pg-activity.sql` | 直查 Dify 库的节点执行耗时（需进容器，沙箱常走不通，优先用 perf-probe） |

模型参数与踩坑结论见技能 `dify-workflow-ops`。
`dify-perf-probe.js` 每次运行会把最近一次的原始输出写到本目录 `.perf-probe-output.json`，看完即删即可。

## 项目接口与业务回归（3000）

| 脚本 | 用途 |
| --- | --- |
| `regression.js` / `regression2.js` / `regression3.js` | 接口回归三批：基础加固 → 限流敏感用例 → 路由分桶限流 + 额度 CAS |
| `model-json.test.js` | **模型输出容错解析**回归，含真实坏数据夹具 `bad-diagnosis-v15.txt`（根对象提前闭合）与 `bad-diagnosis-low-quotes.txt`（字符串内裸英文引号） |
| `quota-402-repro.js` | 复现「有额度却提示次数不足」（额度读取失败被误判为用完） |
| `verify-10img-fix.js` | 端到端验证 10 张图诊断不被空闲超时误杀 |
| `metrics-form-test.js` | 前端纯逻辑自测：核心数据本地记忆、比赛日期拦截等 |
| `feedback-test.js` | 反馈接口校验 |
| `check-db.js` | 线上库体检：重复 (user_id, version)、feedback 表可用性 |
| `repair-broken-records.js` | **运维**：把库里无法解析的 recognition / diagnosis 字符串修补成对象（加 `--apply` 落库） |
| `cleanup-test-users.js` | 清理测试账号（级联删记录 / 订单） |
| `seed-ui-check.js` | 造 UI 验证用测试账号 + 模拟诊断记录 |
| `account-delete-verify.js` | **账号注销 / 数据导出**接口级回归（28 项）：临时账号 → 上传 → 造记录 → 导出 → 三确认注销，再直连 Supabase 断言 users / run_records / orders / feedback / 存储桶全部清空、旧令牌失效。跑前先另起临时实例（见下），`TEST_BASE` 可指端口 |
| `image-privacy-verify.js` | **图片私有化 + 年龄门槛**端到端回归（24 项）：注册/登录 → 上传（须返回签名 URL）→ 预览取图 → 年龄 <14 被拒 → 引用他人图片/路径穿越被拒 → 真实诊断（验 `image_type` 非 unclear）→ 断言 `run_records.images` 存的是对象路径 → 注销。`--skip-diagnose` 跳过诊断那 3 分钟 |
| `storage-privatize.js` | **运维（一次性）**：把存量 `run_records.images` 的公开 URL 改写成对象路径，并把桶设为私有。默认演练，加 `--apply` 才落库与改桶。**顺序不可颠倒**（先改数据后翻桶） |
| `storage-privacy-probe.js` | 只读探针：查桶的 `public` 属性、存量对象数、公开 URL 与签名 URL 各自的可访问性 |

### 浏览器与导出验证（无需浏览器扩展，直连本机 Chrome）

用 `playwright-core` + 本机 Chrome 无头跑，不依赖 `bsk` 扩展；需 `NODE_PATH` 指向托管 node workspace：

```
NODE_PATH="C:/Users/Lenovo/.workbuddy/binaries/node/workspace/node_modules" \
  "C:/Users/Lenovo/.workbuddy/binaries/node/versions/22.22.2-3/node.exe" dev-tests/export-verify.js
```

（`playwright-core` 2026-09-24 起也以 `--no-save` 装进了项目 `node_modules`，直接 `node dev-tests/<脚本>` 亦可。）

| 脚本 | 用途 |
| --- | --- |
| `export-verify.js` | **导出回归**：渲染真实报告 → 点「生成长图」与「导出 PDF」→ 校验下载文件、PDF 魔数与页数、PNG 尺寸。水印渐变一类会让 html2canvas 崩掉的问题靠它兜住 |
| `export-wechat-verify.js` | **移动端 PDF 导出回归**（11 项，4 场景，`TEST_BASE` 指临时实例）：微信 UA（POST 换 URL → GET 真实 PDF 200 → 不弹兜底）、微信+上传被拦（退长图预览）、安卓 share 失败退下载、share 成功无下载。改 `exportPdf` / `isWeChat` / `/api/export/pdf` 路由后必跑 |
| `.pdf-relay-api-check.js` | `/api/export/pdf` 中转路由的 API 级回归（7 项）：未登录 401 / 换 URL / GET 回吐 Content-Type·内容·inline / 坏 token 404（`TEST_BASE` 指临时实例）。注：Node 24 Windows 下结束时 libuv 断言退出码非 0，看 PASS 行为准 |
| `pdf-grad-probe.js` | 定位导出崩溃来源（逐段开关水印/渐变，确认 `linear-gradient` 是元凶）——`style.css` 里「水印底色必须纯色」那条注释就是它的结论 |
| `pdf-export-repro.js` | 最早的 PDF 复现脚本，已被 `export-verify.js` 取代，保留作参照 |
| `ui-shots.js` | 四页顶部截图（桌面 1280 / 手机 390），核对顶栏与按钮布局，输出到 `.ui-shots/` |
| `back-guard-verify.js` | **移动端返回手势回归**（18 项）：手机 UA + 缓存令牌免密进入 → 弱网下（`/auth/me` 延迟 3s）首屏哨兵是否已压、边缘返回是否被拦 → 点确定是否真的离开本页 → 学习园地返回按钮是否指向"进来之前那一页" → 「已退出」收尾页渲染与「重新进入」。改 `show()`／哨兵／`data-nav` 后必跑 |
| `crop-sph-qr.js` | 从竖版视频号卡片里裁出方形二维码 → `public/qrcode-sph-square.jpg`（水印与关注弹窗共用） |
| `.shot-legal.js` | **法律合规外壳核对**：注册页协议勾选、诊断页健康数据单独同意（checkbox 是否被表单样式撑大）、页脚是否被移动端底部导航遮挡、三份法律文本页排版与横向溢出 |
| `.shot-account.js` | **账号与数据核对**（15 项）：首页账号区块与注销弹窗在桌面/手机的布局、真实点击走完导出下载（校验文件内容）与三确认注销全流程 |
| `.shot-follow.js` / `.crop-wm.js` / `.profile-sph*.js` | 一次性核对脚本（关注弹窗截图 + 描述行数测量、等待界面时长文案、水印区裁切、二维码边界探测） |
| `.learn-sheet.js` | 把 `public/learn-media/` 全部动图拼成总览页截图（两帧对比确认动画在动），输出 `.ui-shots/learn-sheet-{a,b}.png` |
| `exit-dialog-verify.js` | **退出确认弹窗统一性回归**（10 项）：右上角"退出登录"与移动端滑动返回两个确认框——标题统一（退出跑悟）、正文同句式、卡片等宽（桌面 380 / 手机 351）、确定与取消按钮等高等宽（此前 ghost 与 danger 差 4px 高、字号差 1px）、手机端按钮双列铺满且无横向溢出。改 `confirmModal` / `.modal-actions` / 两处退出文案后必跑。**注意**：滑动返回拦截只武装 isMobile 环境，桌面段脚本要用移动 UA + 宽视口才能弹出第二个框；headless 下弹窗内按钮的 Playwright actionability 预检与页面实测矛盾，弹窗内点击用 `evaluate` 派发 |
| `learn-media-verify.js` | **学习园地动图接入回归**（13 项）：点真实导航进园地 → 展开 → 滚动触发懒加载 → 18 张 SVG 动图全部加载/图注齐全/**功能卡齐全（学名徽章 18、功效+肌肉+注意行 54、肌肉药丸 ≥36、注意行 18）**/原创声明渲染/手机端无横向溢出/无脚本错误。改 learning.json、renderLearn 或重新生成动图后必跑 |
| `gen-learn-media.js` | **学习园地动图生成器**：骨架小人姿势关键帧数据 → SMIL 补间 SVG 动画（`public/learn-media/*.svg`，共 18 张）。v2 起按人体比例模板（大腿/小腿 31、上/前臂 21、躯干 38、脚 13）+ **joint() 两圆交点自动求膝/肘**（骨长恒定）+ **骨长 lint**（偏差 >18% 告警）+ **缺关节防线**（undefined 关节直接抛错，防渲染成 (0,0) 长线）。改姿势/节奏改本文件再跑，**不要手改生成物** |

**测后端改动别动正在跑的 3000**：另起一个临时实例，测完杀掉。`export-wechat-verify.js` /
`.pdf-relay-api-check.js` 涉及 `/api/export/pdf` 新路由，必须打在**起过新代码的临时实例**上
（`TEST_BASE=http://127.0.0.1:3010`），3000 未重启前没有这条路由。

```bash
PORT=3010 "…/node.exe" api/index.js &                      # dotenv 不覆盖已有环境变量，PORT=3010 生效
TEST_BASE=http://localhost:3010 "…/node.exe" dev-tests/account-delete-verify.js
```

限流桶是**进程内存**的，同一个实例连跑两轮会被上一轮残留计数打成 429（流程中段整片失败）；
**重跑前先杀实例再起**，不要用 sleep 等窗口。

## 凭据与数据文件（勿提交、勿改名）

| 文件 | 说明 |
| --- | --- |
| `.dify-appkey.txt` | Dify 服务 API Key（`app-` 开头），跑工作流用 |
| `.dify-cookie.txt` / `.dify-csrf.txt` | 控制台会话，由 `dify-login.js` 刷新，会过期 |
| `.dify-admin-pwd.txt` | 控制台管理员密码（《Dify工作流搭建手册》引用此路径） |
| `.dify-draft-backup-before-tuning.json` | 调参前的完整草稿备份，出问题可原样回灌 |
| `.dify-draft-backup-before-metrics.json` | 扩跑姿指标前的草稿备份（含旧 8 字段白名单） |
| `.ab-input.json` | `dify-ab-matrix.js` 的固定输入夹具（10 张图 + 全马目标），**勿删**，换用例直接改它 |
| `.ab-input-sparse.json` | 稀疏输入夹具（只 1 张图，验证"数据少也不提示缺失"），**勿删** |
| `dev-tests/tmp-verify-payload.json` | 一份诊断输出夹具。测试脚本从本地读取后注入浏览器，不经 `express.static` 对外公开；换用例直接改内容即可。 |
| `bad-diagnosis-v15.txt` | `model-json.test.js` 的真实坏数据夹具（根对象提前闭合），**勿删** |
| `bad-diagnosis-low-quotes.txt` | 同上，真实坏数据夹具（字符串内裸英文引号），**勿删** |
| `.fixtures/run-data-sample.jpg` | `image-privacy-verify.js` 的测试素材（一张真实跑步 App 截图）。**仓库里可以没有它**——脚本会按对象路径现签一张下来自动补齐（桶已私有，不能再取公开地址） |

## archive/ —— 历史产物，仅供查阅

里面的脚本相对路径引用已失效（`../lib` 等不再成立），**不要直接运行**。

- `legacy-coze/`：扣子平台时期的临时调试脚本与输出（平台已切 Dify，相关链路作废）
- `dify-setup/`：Dify 自托管安装期的一次性排障脚本（模型切换、挂起二分、堆栈导出等）
- `db-oneoff/`：一次性数据库排查脚本（问题已定位并修复）
- `outputs/`：历次运行输出留档（耗时实测、UI 截图等）

确认无用后整目录删除即可：`rm -rf dev-tests/archive`。
