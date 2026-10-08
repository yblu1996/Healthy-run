# 项目长期笔记 · 跑悟（Healthy-run）

> 本文件只放**长期有效的结论、约定、红线**。每日过程细节、实测数据、排障过程见同目录 `YYYY-MM-DD.md`。
> 整理于 2026-09-24，上一版全文备份在 `archive/MEMORY.md.bak-20260924-pre-organize`。

## 1. 定位与商业

面向健康跑步人群的网页端 AI 诊断与训练规划平台。四大功能：上传截图+文字 AI 分析、按次收费（9.9 元/次）生成 8 周方案、个性化目标（半马/全马）备战方案、清新界面。
用户数据沉淀为个人专属档案，再次登录可纵向对比、更新方案。品牌名「跑悟 · AI 跑步诊断」。

## 2. 技术架构与运行（本地）

- **链路**：前端无构建静态单页（`public/`）→ Express 后端（`api/index.js`，3000）→ 自托管 Dify（8180，AI 大脑）→ Supabase（Postgres + Storage）。
- **一键启动**：`C:\Users\Lenovo\WorkBuddy\一键启动.bat` 编排 Dify(8180) + 跑悟(3000) + 起名测名(3210)，各占一个独立 cmd 窗口（关窗口即停）。脚本第 0 步先 `pm2 delete health-app / as-naming` 清隐藏实例。
- ⚠️ **pm2 自启与一键启动打架**：计划任务「PM2 Resurrect OpenClaw」+ 启动目录 `boot-hidden.vbs` 会 resurrect 出 `health-app`/`as-naming` 抢端口（表现为 `EADDRINUSE port 3000` 死循环、as-naming 漂到 8080 被误判"已在运行"）。修复二选一：全走 pm2 托管，或关掉 pm2 resurrect 自启。
  **2026-09-24 实测现状**：pm2 daemon **未运行**，`~/.pm2/dump.pm2`（9-21 存档）里仍登记 `health-app`/`as-naming`，但只要没人执行 `pm2 resurrect` 就不会发作；当前 3000/3210 是 `run-hidden.vbs` 直接拉起的 node，**与 pm2 无关**（`pm2 jlist` 为空）。注意 **`pm2 <任意命令>` 会顺带 spawn 一个空 daemon**（`pm2.pid` 文件出现即为标志），查完要 `pm2 kill` 收尾。
- ⚠️ **`一键停止.bat` 不清理 pm2**（启动侧有防护、停止侧没有）：若 pm2 daemon 在跑且管着 health-app/as-naming，脚本的 `taskkill /F` 杀掉监听进程后 **pm2 的 autorestart 会把它们再拉起来** → "停了又起来"。当前 pm2 为空，所以不发作。另外它**不停 Openclaw(18789)**，尽管标题写着 "all services"。
- **`一键启动.bat` 是幂等的，平常不必先跑 `一键停止.bat`**：每个服务先做健康检查，健康即 skip、异常才启动。**唯一需要先停止的场景**：某服务已健康在跑但你希望它重启（例如跑悟要加载新的后端代码，否则会被 skip 掉一直跑旧代码）。
- ⚠️ **改 `.bat` 后必须检查「块内未转义括号」**：cmd 中 `if (...)` 块内部的 `echo 1) xxx` 里那个 `)` 会被当成**块结束符** → 致命解析错误，**批处理当场中止、窗口自动关闭**（2026-09-24 实测：一键启动跑完 Dify 后静默退出，跑悟/起名都没起来）。块内 `echo`/`rem` 一律不用圆括号，或写成 `^)`。检查办法：按行跟踪括号深度（`) else (` 净深度不变），并检查深度>0 时 `echo|rem` 参数里是否有未转义的 `(`/`)`。
- 💡 **判断批处理有没有跑完**：看 `WorkBuddy/logs/paowu.log`、`naming.log` 的**修改时间**——没更新 = 根本没走到那一步（而非"启动失败"）。
- ⚠️ **重启 3000 只能由用户双击「一键启动.bat」**：后端无热重载，改 `api/index.js` 必须重启；沙箱拦 `wscript`/`cscript`，`spawn(detached)` 拉起的进程会被会话清理。改代码或改桶属性后**务必提醒用户重启**。
- **测后端改动别碰用户正在跑的 3000**：另起 `PORT=3010` 实例（dotenv 不覆盖已有环境变量，故 PORT 生效），测完杀掉。
- ⚠️ **Dify(8180) 起不来时，要修的是 containerd，不是重启 docker**（2026-09-24 定位）：`service docker restart` 的 stop 阶段要等 **12 个容器逐个退出（约 109 秒）**，等完才启新 dockerd，而 containerd 已被一起停掉；新 dockerd 发现 containerd 未运行会退化为自拉临时实例、**只等 15 秒就放弃**（`/var/log/docker.log`：`failed to start containerd: timeout waiting for containerd to start`）→ dockerd 退出 → `docker compose up -d` 报 `Cannot connect to the Docker daemon` → 8180 永远等不到。
  自愈脚本 **`C:\Users\Lenovo\WorkBuddy\dify-runtime-up.sh`**（由 `一键启动.bat` 的 Dify 分支调用）**原写法"restart + 写死等 10s + compose"必然失败，已弃用。**
  ⚠️ **改这个脚本前必须记住两条硬事实**（2026-09-24 实测）：① docker 29.8.1 以 **`containerd-snapshotter=true`** 运行，镜像数据全在 containerd 数据根 **`/var/lib/docker/containerd/daemon`（约 9.3G）**，这是 dockerd 托管 containerd 的默认 root；② dockerd 启动时**先在 `/run/containerd/containerd.sock` 探测**，那里有就绪的 containerd 就直接采用（日志写 `Creating a containerd client address=/run/containerd/containerd.sock`、**无** `starting managed containerd`），找不到才自拉托管实例。
  → 正确做法：**主动用 `--root /var/lib/docker/containerd/daemon` 把 containerd 放到 `/run/containerd/containerd.sock`**，dockerd 直接接管，既绕开 15s 超时又不会看不到镜像。判据：`containerd-managed.log` 应打印 `successfully booted in 0.0xxxs`（<1s），compose 时**不应出现下载进度**。
  ⚠️ 反面教训：用**默认 root 裸跑 `containerd`** 会新建空库 `/var/lib/containerd`，dockerd 照样采用但**看不到镜像 → 静默重下几 GB**（实测 7 分钟下了 1.8G）。确认正常后空库可删。
  ⚠️ 第二个坑：**强杀 containerd 会留下 shim/runc 残骸**，新 containerd 起来启动老容器会报 `OCI runtime create failed: runc create failed: container with given ID already exists`（09-24 12:08 实测 daemon 启动瞬间 12 个容器全中，随后 compose 触发的启动自愈成功）。脚本清理步骤已补上 `pkill -9 -x containerd-shim-runc-v2` + `rm -rf /run/containerd /run/docker/runtime-runc /run/docker/containerd`（均为 tmpfs 易失状态，镜像与数据卷在 `/var/lib/docker` 不受影响），并支持 `FORCE=1` 强制走完整修复。
  **判断 Dify 是否真就绪**：Windows 侧 `curl -s -m 8 --noproxy "*" -o /dev/null -w "%{http_code}" http://127.0.0.1:8180/apps`，`200` 才算好（预热期会 `000`/`502`）。compose 输出刷屏 ≠ 重新下载，判据是首行 `[+] up n/m`（含 `Pulling` 才是下载）。
- ⚠️ **不要在 一键启动.bat 的 Dify 分支里做 `wsl --shutdown`**：Openclaw 自愈在该分支**之前**就跑完了，冷启会把刚就绪的 gateway 杀掉且不补。确需冷启要按 关服务 → `wsl --shutdown` → 重跑 一键启动.bat 的顺序。
- **在 WSL 里排查容器问题的手段**：`//wsl$/Ubuntu/...` 的 9p 共享**可直读 WSL 内文件**——`/var/log/docker.log`、`/var/log/dockerd.log`、`/etc/containerd/config.toml` 都能读（`/var/lib/docker` 是 0700 会被拒）。但 **`wsl.exe` 本身被本机安全策略拉黑，AI 不能执行任何 `wsl` 命令**（也不能借别的 shell 绕），只能「读文件拿证据 + 写脚本让用户执行」。

## 3. AI 链路：Dify 工作流（核心资产）

- **节点**：识图 `vision_1`（温度 0）→ 诊断+计划 `diag_1`（温度 0.3）。结束节点**双输出** `recognition` + `diagnosis_result`，后端按这两个字段分别入库。知识库不拆，训练学规则写在系统提示词里。
- ⚠️ **`reasoning_effort` 必须显式设置，绝不留默认**（GLM 不设即 `max`，思考链吃光 `max_tokens` → 输出截断、JSON 丢失，正是"等 5 分钟却提示报告数据异常"的成因）。**现行线上 = `high`（两个节点）**。改档唯一入口：`node dev-tests/dify-apply-reasoning.js <low|high|max>`（存草稿+发布一步到位）。
- **耗时数字不可采信单次测量**：同档两次差 2~4 倍，且总是"后跑的更快"（服务端排队/预热主导）。可稳定复现的只有：high 识图更慢、high 诊断输出体量约 2~3 倍、high 10 图全链路约 2.9 分钟。
- **识图质量与思考强度无关**（视觉取数是感知任务），要提升覆盖**只能改提示词 `metrics` 白名单**。
- **`metrics` 白名单 17 字段**（原 8）：基础 + `fastest_pace_min_per_km`、`avg_stride_cm`、`ground_contact_time_ms`、`vertical_oscillation_cm`、`ground_balance_left_pct`/`right_pct`、`vo2max`、`aerobic/anaerobic_training_effect`。改动脚本 `dify-expand-metrics.js`；**改字段名必须同步前端 `RECOG_GROUPS`**。
- **多次跑步契约**：一次传多图含多次跑步时，`metrics` **恒等于日期最新那一次**（单次指标唯一出口），`runs[]` 只放轻量摘要（date+距离/配速/心率/步频），单次时 `[]`。只加白名单不写契约会回退。
- **`weekly_volume_km` 消歧**：只填标注「本周/近 7 天」的值；只看到「累计/总里程/本月」填 null（否则诊断会输出"填报 25km 但截图 54km"这类假问题）。
- **提示词三条防线不可丢**：① 缺项就当不存在、不得提及（唯一例外 `image_type=unclear`）；② JSON 字符串值内**禁英文双引号**（用「」、配速写 `5'49`）；③ `plan_8_weeks` 正好 8 项。
- **训练规则写成硬要求逐条自检**：周跑量递增 ≤10%、80/20 强度分布、每周 runs 含 1 条「全休」、2 条「力量」且不得合并。软描述会不达标。
- **写"没出现的字段填 null"时模型不会去 `user_text` 取值**，要用填报值必须显式写取值优先级。
- **模型输出两道容错闸门，缺一不可**：`lib/model-json.js` 的 `parseModelJson()`（剥 `<think>`/围栏 → 取最外层 `{}` → 去尾逗号 → 删根对象提前闭合的多余 `}`，字符串感知；夹具 `bad-diagnosis-v15.txt` / `bad-diagnosis-low-quotes.txt` + `model-json.test.js`）；`api/index.js` 的 `pickDiagnosis()` 闸门（非有效对象 → 标 failed + **不扣次数** + 提示重新提交）。
- **改工作流的操作纪律**：`GET/POST /console/api/apps/{id}/workflows/draft`，**POST 必须回传 GET 到的顶层 `hash`**，否则 409 `draft_workflow_not_sync`；改完必须 `POST .../workflows/publish`（服务 API 跑的是已发布版）。控制台 cookie 约 2 小时过期（表现为 `draft.graph === undefined`），先跑 `node dev-tests/dify-login.js`。草稿备份 `dev-tests/.dify-draft-backup-before-*.json`。
- `cleanStalePending` 阈值 **20 分钟**，必须大于 `lib/dify.js` 的 15 分钟硬超时，否则在跑的记录被误标失败并放行重复提交。
- **A/B 夹具与线上档位联动**：`dify-ab-matrix.js` 收尾恢复读 `PROD_EFFORT`（默认 high，**勿改回写死 low**），内置 `freshImageUrls()` 开跑前现签图片 URL。

## 4. 数据与存储

- **桶 `run-images` 为私有**（`public: false`）。`/api/upload` 返回**签名 URL**（`SIGNED_URL_TTL` 默认 3600s）；`run_records.images` 存**对象路径** `<user_id>/<文件名>`；`/api/diagnose` 用 `imageObjectPath()` 解析路径并**校验必须落在本人 `user_id/` 目录**（旧代码不校验归属），再用 `signImagePaths()` 现签给 Dify。
- **前端不展示用户上传的图**，唯一消费方是 Dify 拉图。对照实验已证**签名 URL 与公开 URL 识图结果一致**（`dify-image-access-probe.js`）→ 私有化对页面与识图零影响。
- ⚠️ **判"识图有没有读到图"只看 `image_type`，绝不看指标条数**：拉取失败才是 `unclear`，而单图/总览类截图本来就可能 17 项全空。曾因拿"条数>0"当判据误报失败。
- ⚠️ **测试脚本/A-B 夹具里若留着旧公开 URL 必须先重签**，否则识图静默拿到空图、结论全错却不报错。
- **Supabase 公共 URL 走 CDN**：文件删掉后旧 URL 仍可能返 200。断言要加 `?cb=<时间戳>` 绕缓存，并以 `storage.list(prefix)` 为准。**合规含义：注销后图片在 CDN 缓存期内仍可能被访问。**
- ⚠️ **升级后必须重跑 `sql/schema.sql`（幂等）**。列表查询与回写依赖 `summary`/`risk_level`/`goal_type` 三列，缺列会导致历史页空白、首页档案 0 次、结果不入库但额度照扣。
- **迁回境内的迁移面**：`lib/db.js` 仅 13 行、`api/index.js` 34 处 `.from()` + 4 处 storage、**`sql/schema.sql` 零改动（标准 PG → 故选 PostgreSQL 不选 MySQL）**、auth 是自研 JWT（**不碰 Supabase Auth**）。选型：轻量服务器 + 自建 PG + COS。WorkBuddy 内置云服务与本架构冲突（不给自建后端 service-role）。

## 5. 后端接口纪律

- ⚠️ **读取失败 ≠ 额度用完**：`/api/diagnose` 读取用户失败要返 **500**，只有确凿 `quota<=0` 才返 **402**（曾把读取失败误判为次数用完，用户剩 88 次也被拒）。复现脚本 `dev-tests/quota-402-repro.js`。
- **JWT** 自研，30 天有效，payload **只放 `user_id`**（JWT 是签名非加密，base64 可解，不放手机号）；密码 `bcryptjs` 哈希；`multer` 用 2.x。
- **注册与找回密码都绑定 `invite_code`**：注册必填、重置时手机号+邀请码必须一致。上线前换短信验证码。
- **验证期 `/api/pay` 是模拟支付**，正式收费时替换为微信支付 V3，前端不用改。
- **限流桶是进程内存的**：同实例连跑两轮测试会被上轮残留计数打成 429，且流程中段整片失败、看似无规律 → 重跑前先杀实例。
- **账号注销/导出**：`GET /api/account/export`（打包 users/run_records/orders/feedback，**不交付 `password_hash`/`security_answer_hash`**）、`DELETE /api/account`（三确认：密码 + 手输「注销」+ 前端确认框）。入口在首页档案下方 `.acct-card`「账号与数据」。
  - ⚠️ **删除顺序不可颠倒：先清存储桶，再删数据库**（users 行删掉后文件名线索就没了，只剩清不掉的孤儿文件）。存储删除失败要 500 中止，不留"半注销"。
  - ⚠️ **`feedback.user_id` 外键是 `on delete set null`**，必须显式 delete，否则反馈以匿名形式留在库里。接真实支付后 `orders` 要改成匿名化保留（代码注释已标）。

## 6. 前端关键点

- ⚠️ **移动端顶栏必须保持两行 99px**——变三行会压住报告页/学习页的吸顶返回栏。桌面「品牌居左 / 导航+关注+账号右侧一簇」（`flex-start` + `.nav-links{margin-left:auto}`）；手机端 `#btnFollow{margin-left:auto}`。
- **吸顶返回栏**：`show()` 给 body 打 `has-backbar`（report/learn），移动端这两页顶栏改 `static`、返回栏 `top:0`。
- **学习园地返回按钮=返回"进来之前那一页"**（2026-09-24 修）：`show()` 记录 `prevView`，进园地时改 `#learnBack` 的 `data-nav` 与文字（`PAGE_NAMES` 映射）。**加新页面要往 `PAGE_NAMES` 补名字**，否则 `prevView` 不会被更新。
- **防边缘滑动误退出（2026-09-24 重做）**：压哨兵 history 记录 + popstate 弹确认框。四条铁律：① **有缓存令牌就在脚本末尾先武装**（`if (state.token) armBackGuard()`），不能等 `/auth/me` 回来——否则免密进入首屏那 1-3 秒滑动直接掉出程序；② popstate 里**先补压哨兵**再弹窗，否则连滑两下漏出去；③ **确认退出连退两级**（一级只退到本应用根条目，同文档、界面不动，旧版"点确定没反应"就是这个）；④ **脚本关不掉浏览器自己**，退出分三级：微信 `WeixinJSBridge.invoke('closeWindow')` → 有上一页时连退两级 → 落到 `#view-exit`「已退出」收尾页（`noPrevEntry` 判据＝压哨兵前 `history.length<=1`）。另有 `ensureGuard` 在 `load`/`pageshow`/页面重新可见时补压。回归脚本 `dev-tests/back-guard-verify.js`（18 项，手机 UA + 缓存令牌）。
- **导出**：⚠️ **水印底色必须纯色**——`linear-gradient` 会让 html2canvas 抛 `addColorStop: non-finite`，长图与 PDF 全废。导出前自动展开全部周计划、导完恢复用户折叠状态。三码水印（左公众号 / 中程序码 / 右视频号），二维码 `public/qrcode-gzh.jpg`、`qrcode-sph-square.jpg`（1060×1377 竖版原图经 `crop-sph-qr.js` 裁成 777×777 方形，否则被压扁），缺图自动降级为纯程序码。
- **文件落地策略**：桌面走 `a.download`，**只在触屏端**才走 Web Share（桌面 Chrome 的 `canShare({files})` 也为真，无脑 share-first 会弹分享面板）；share 失败（非用户取消）必须退回下载。
- **关注弹窗定稿（2026-09-24，勿再用旧版）**：`公众号 · 产业路书` + `作判断、讲方法、找路径`；`视频号 · 路远山高2049` + `讲产业，也聊人生判断`。**平台名与账号名必须同一行加粗**（`.follow-item strong`，13.5px/600/近黑），简介 ≤12 字（超了会折行、两栏不对称）。废弃文案：「产业路书 · 干货长文」「路远山高2049 · 跑姿示范」「也聊人生路上的判断」。
- **诊断等待时长口径 = 「3-5 分钟」**，共 5 处（前端 4 处静态、`api/index.js` 重复提交拦截 1 处需重启）。进度条打勾 `stepTimes=[0,70s,200s]` 刻意保守不跟随收紧。
- **页脚 `.site-foot` 是全局的**（版权行 + 三份法律文本入口 + 微信 yblu1996）。移动端底部导航是 fixed，页脚 `padding-bottom:86px` 是刻意避让。
- **科普内容数据化**：`public/learning.json`（6 分类 21 条），首页档案第 4 格入口，增删改只动 JSON。
- **前端/导出验证**：`playwright-core` + 本机 Chrome 无头，`NODE_PATH` 指向托管 node workspace 的 node_modules（不需要浏览器扩展）。三个坑：报告页无有效令牌会被 401 踢回登录页（要自签真 token）；渲染后要等 `bootstrap()` 的 `/auth/me` 回来否则被 `show('home')` 顶掉；`express.static` 不服务点号开头的文件。
- **三方库 CDN 一律用 BootCDN**（jsdelivr 国内不稳）。
- **前端混淆（B 组第 9 项）尚未做**：无构建静态前端，压缩会剥掉有价值的注释且防抄袭收益低（真正的 IP 是服务端提示词），要做需引入构建产物，待用户决定。

## 7. 合规与经营主体（上线前置）

- ⚠️ **协议主体必须写实名「路玉宝」**（`public/legal/` 的 terms/privacy/disclaimer + 共用 `legal.css`）。"产业路书"只是公众号账号名，不是法律主体，**甲方/版权所有者/备案主体都不能写它**。品牌名可并列。
- **同意机制两处，不要混**：注册页 `#agreeTerms`（协议+隐私+出境，仅注册模式显示，`switchAuth()` 控制）；诊断页第 1 步 `#consentHealth`（**敏感个人信息单独同意**，PIPL 第 29 条要求独立勾选框，勾过记 `localStorage.consentHealth`）。**两处都不设默认勾选**（默认勾选等于没取得同意）。js 里 checkbox 必须显式覆盖 `.auth-form input` 的 11px 内边距。
- **年龄门槛已修**：前端 `mAge` `min=14` + 后端兜底 `MIN_AGE=14`/`MAX_AGE=100`。14 与《隐私政策》第八节"不满 14 周岁不要注册"对齐，**改前先看那里**。若更保守，两处一起调 18（14~17 岁仍是风险缺口）。
- **数据出境是既定事实，已如实披露**：Supabase 在境外（账号/诊断记录/图片），智谱 GLM 在境内处理图片与文字。隐私政策列了接收方清单并单列出境条款。
- **出境这个事实的定性（勿重复论证，详见《数据出境与迁回境内评估.md》）**：跑悟数据构成**敏感个人信息**（输出健康评估性质内容 + 跑姿照片含**步态**属生物识别）→ 《促进和规范数据跨境流动规定》第五条豁免原文写明"不含敏感个人信息" → **无人数下限**。三条出境路径实操全堵死（卡点在境外接收方不配合），**迁回境内是唯一可行解**。
- ⚠️ **真正的代价在主体不在技术**：迁回境内 ⇒ 强制 ICP 备案 ⇒ **个人备案不得从事经营性活动（不能收费）**，收费需 ICP 经营许可证（须内资公司）。**"数据出境 / ICP 备案收费 / 微信小程序收款"三个问题收敛成同一个前提：注册经营主体。** 微信小程序个人主体**开不了支付商户号、不支持 web-view、医疗类目禁选**，且**主体类型选定后不可变更**——"先用个人主体试水"是不可逆错误。
- **页脚备案占位在 4 个文件里都是 HTML 注释**（`public/index.html` + 三份 legal 页，含公安网备），注释里的 `京ICP备XXXXXXXX号` 是占位符不是真号，备案下来替换，链接必须指工信部官网。
- **红线**：迁回境内后模型必须境内（智谱 ✓）；早期 `coze.com` 是境外，**不可回退**。

## 8. dev-tests 目录纪律

- 根目录只留活跃工具（脚本按用途分组见 `dev-tests/README.md`），历史文件归入 `archive/{legacy-coze,dify-setup,db-oneoff,outputs}`。项目**非 git 仓库**且 `dev-tests/` 在 `.gitignore`，删除无可回滚 → **一律归档不删除**。归档内脚本的相对路径引用（`../lib`）已失效，仅供查阅。
- **不可移位/删除的依赖文件**：`bad-diagnosis-v15.txt`、`.ab-input.json`、`.dify-appkey.txt`/`.dify-cookie.txt`/`.dify-csrf.txt`（脚本按 `__dirname` 直读）、`.dify-admin-pwd.txt`、`.dify-draft-backup-before-*.json`。

## 9. 待办 / 待决策

- ✅ **跑悟服务已重启（2026-09-24 13:00 核实）**：3000 已跑新后端代码（`/api/account/export` 返 401＝路由存在）。此后**只改前端（`public/`）无需重启**，手机端刷新页面即可。
- ⏳ **注册经营主体**（一次性解锁出境合规 / ICP 经营备案 / 收款三件事），未决则内测不能转正式收费。
- ⏳ 前端混淆是否做（需引入构建）。
- ⏳ pm2 自启与一键启动二选一（见 §2）。
- 已知残留：CDN 缓存期内旧公开地址可能短暂生效；14~17 岁未成年人风险缺口。

## 10. 历史演进（已废弃，勿回退）

- 最早方案是**扣子 coze.com** 当 AI 大脑 + 多模态识图，后整体切到**自托管 Dify（8180）**。扣子识图经验（`image1`~`image10` String 非必填、须在「视觉理解输入」区引用并改 Image 类型、提示词里必须写 `{{image1}}`、判据是 input token 随张数增长）仅作历史参考。coze.com 在境外，不可回退。
- 早期部署方案 Vercel + Railway 分离（Vercel serverless 10s 超时扛不住 30-60s 链路）已被本地运行取代。
- 项目目录由 `健康跑程序` 改名为 `Healthy-run`（2026-09-21）。
