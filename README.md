# 跑悟 · AI 跑步诊断平台 —— 搭建与配置清单

本仓库包含可本地运行的前后端和部署清单。2026-09-30 的识图契约、8 周报告校验和趋势图整改已进入代码；正式收费与线上视觉模型验收仍需按[核查报告](跑步数据识别与8周动态计划核查报告.md)第六节完成。每次提交仍生成一份新的完整 8 周计划。

---

## ⚠️ 上线前安全清单（先看这个）

1. **`.env` 已被 `.gitignore` 排除，绝不能把真实密钥写进 `.env.example` 或任何会提交的文件**。历史上曾发生过一次（已轮换密钥），再犯没有借口。
2. **`JWT_SECRET` 必须 32 位以上随机串**，太短服务会拒绝启动。生成：`npm run secret`。
3. 本项目要求 **Node.js 18+**（代码用全局 fetch 调扣子）。
4. 前后端分域部署时，在后端 `.env` 配 `ALLOWED_ORIGINS=https://你的前端域名`（逗号分隔可多个），否则浏览器跨域请求会被拦。
5. 支付默认关闭。仅非生产测试环境显式配置 `PAY_MODE=mock` 才能模拟加次；`NODE_ENV=production` 一律拒绝模拟支付。正式收费前必须接入真实支付及订单对账。

---

## 项目结构（已写好，不用动）

```
Healthy-run/
├── api/index.js         后端所有接口（注册登录/找回密码/上传/诊断/历史/趋势/限流/支付）
├── lib/                 数据库、身份验证、AI 供应商与诊断数据契约
├── public/              前端单页：index.html + style.css + app.js + learning.json
│   └── vendor/          前端依赖本地化（echarts/html2canvas/jspdf/qrcode，不再走 CDN）
├── sql/schema.sql       建表语句（幂等，可重复执行）
├── dev-tests/           开发期调试脚本存档（与线上无关）
├── .env.example         环境变量模板（只有占位符）
├── vercel.json          部署配置
└── 扣子工作流设计方案.md  工作流节点与 prompt 详细设计
```

---

## 第一步：配 Supabase（约 10 分钟）

1. 打开 https://supabase.com 注册并登录（可用 GitHub 账号）。
2. 点 **New Project**，名字随便填（如 run-diagnostic），区域选最近的，数据库密码设一个并记牢。
3. 项目建好后，左侧菜单进 **SQL Editor**，点 **New query**，把 `sql/schema.sql` 的全部内容粘贴进去，点 **Run**。看到 "Success" 即建表完成。
   - schema.sql 含 `add column if not exists`，**可安全重复执行**；老项目升级时重跑一遍即可补上密保字段及 run_records 的 summary / risk_level / goal_type。
   - ⚠️ **不重跑会导致诊断结果存不进库**：列表查询和回写都依赖这几个新字段，缺列时查询会整体报错（历史记录页空白、首页档案显示 0 次）。
4. 建存储桶（存用户上传的图片）：
   - 左侧菜单 **Storage** → **New bucket**
   - 名称填 `run-images`，**不要勾选 Public bucket**（保持私有），Create。
     公开桶生成的是永久、无鉴权的地址，谁拿到链接都能看别人上传的跑姿照片；而跑姿照片含步态特征（属生物识别敏感信息）。
     代码按需签发短期链接（默认 1 小时，见 `api/index.js` 的 `signImagePaths`），不需要桶公开。
   - 若桶已经建成公开的，改私有：**Storage → 选中桶 → Settings → 关闭 Public**，或跑 `node dev-tests/storage-privatize.js --apply`（会顺带把库里遗留的公开 URL 改写成对象路径）。
5. 拿密钥：左下角 **项目设置（Project Settings）** → **API**，复制两个值：
   - `Project URL` → 对应 `.env` 里的 `SUPABASE_URL`
   - `service_role` 密钥（点 Reveal 显示，**注意这是绕过权限的总密钥，只放后端，绝不放前端**）→ `SUPABASE_SERVICE_ROLE_KEY`

---

## 第二步：配扣子工作流（约 20 分钟）

1. 打开 https://www.coze.com 注册并登录（需要能访问国际网络）。
2. 顶部菜单 **Workflow** → **Create workflow**，取个名字（如 run-diagnose）。
3. 按设计方案建 4 个节点：
   - **开始节点**：依次添加输入参数 `images`（Array,String）、`user_text`（String）、`goal`（String）、`race_date`（String）、`history`（String）。
   - **节点 1 识图**：选多模态大模型（Claude 3.5 Sonnet 或 GPT-4o），温度设 0，系统提示词复制《扣子工作流设计方案.md》第三章，**输出格式选 JSON**。
   - **节点 2 诊断+计划**：选同一个或更强的模型，温度 0.3，系统提示词复制第四章；用户消息里引用开始节点和节点 1 的变量（`{{user_text}}`、识图结果、`{{history}}`、`{{goal}}`、`{{race_date}}`），输出格式选 JSON。
   - **结束节点**：输出变量设两个——`recognition` 引用节点 1 的输出，`diagnosis_result` 引用节点 2 的输出。这样后端才能分别存档识图结果和诊断结果。
4. 右上角 **Try it** 用一张跑步截图自测一遍，确认输出 JSON 格式正确。
5. **Publish** 发布。
6. 拿调用凭证：
   - 工作流发布后，页面里有 **Workflow ID**（形如 `7400...`），复制待用。
   - 右上角头像 → **Settings** → **Access Tokens** → **Create Token**，生成 PAT，复制待用（**只显示一次，请保存好**）。

---

## 第三步：本地启动验证（约 2 分钟）

1. 在项目根目录复制环境变量模板，填入上面拿到的值：

   ```
   cp .env.example .env
   ```

   用编辑器打开 `.env`，填写：
   - `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（第一步；**URL 只填项目根地址，不要带 `/rest/v1` 后缀**）
   - `COZE_WORKFLOW_ID`、`COZE_PAT`（第二步；`COZE_BASE_URL` 只填域名，不要带 `/v1/workflow/run` 路径）
   - `JWT_SECRET` 执行 `npm run secret` 生成（32 位以上随机串，太短服务会拒绝启动）

2. 启动：

   ```
   npm start
   ```

3. 浏览器打开 http://localhost:3000
   - 注册一个账号（注册送 3 次免费诊断）
   - 上传一张跑步 App 截图，写两句描述，点开始分析
   - 约 1-3 分钟后看到诊断报告和 8 周计划，说明全链路打通

---

## 第四步：部署上线

**重要提醒：Vercel 免费版 serverless 函数有 10 秒超时限制，而扣子工作流要跑 30-60 秒，直接部署后端到 Vercel 会超时失败。**

推荐方案：**前端放 Vercel，后端放 Railway（支持长连接，免费档够验证期）**。

### 前端部署到 Vercel

1. 把项目推到 GitHub。
2. Vercel 中 Import 该仓库，框架选 Other，Build/Output 不用改（自动识别 public 目录为静态站），部署。
3. 部署后得到前端地址（如 https://xxx.vercel.app）。

### 后端部署到 Railway

1. https://railway.app 注册，New Project → Deploy from GitHub repo，选同一仓库。
2. 设置：
   - Start command 填 `npm start`
   - Variables 里填 `.env` 的全部变量（SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、COZE_BASE_URL、COZE_WORKFLOW_ID、COZE_PAT、JWT_SECRET、STORAGE_BUCKET）
   - **别忘了 `ALLOWED_ORIGINS`**：填你的 Vercel 前端域名，否则浏览器跨域请求会被拦
3. 部署成功后拿到后端地址（如 https://xxx.up.railway.app），在 Settings → Networking 生成公开域名。

### 前后端连通

后端地址拿到后，修改 `public/app.js` 第一行：

```js
const API = 'https://你的后端地址.up.railway.app/api';
```

重新部署前端即可。静态文件已由各平台自动托管，`vercel.json` 里的 rewrite 规则仅用于把 /api/* 请求转给后端函数（全栈单部署时才需要，前后端分离部署可忽略）。

---

## 找回密码：密保问题（验证期方案）

注册时选择一个**密保问题**并填写**密保答案**（答案只存 bcrypt 哈希，数据库泄露也拿不到原文）。忘记密码时：输入手机号 → 系统显示你的密保问题 → 答对即可设置新密码。免短信验证码（免备案、零成本）。防爆破已内置：同一手机号 5 次答错锁 15 分钟。

- **老账号迁移**：未设置密保问题的早期账号无法自助找回密码，需联系管理员核实身份后重置。
- **依赖迁移**：需在 Supabase SQL Editor 重跑 `sql/schema.sql`（新增 users.security_question / security_answer_hash 两列，幂等）。
- 开放公网注册后建议升级为短信验证码找回。

---

## 用户反馈查看（两级归档）

1. **飞书群实时推送（推荐）**：飞书群 → 右上角设置 → 群机器人 → 添加"自定义机器人" → 复制 Webhook 地址，填到 `.env` 的 `FEISHU_WEBHOOK_URL` 并重启服务。之后每条用户反馈（内容 + 联系方式 + 用户手机号 + 时间）会实时推到群里。
2. **数据库归档**：所有反馈存在 Supabase 的 `feedback` 表（Table Editor 可查、可导出）。依赖上文 schema.sql 的 feedback 建表语句，老库务必重跑一遍。

---

## 支付状态

`POST /api/pay` 默认返回“支付通道暂未开放”。仅本地/非生产验证期显式设置 `PAY_MODE=mock`，才可模拟增加 1 次，不扣真钱；模拟订单标为 `mock_paid`。生产环境不会开启该入口。真实收费需要服务端验签、核对订单金额与交易号、幂等入账和对账；目前尚未接入。

---

## 从扣子迁移到 Dify（已就绪，按需切换；扣子链路不受影响）

> **详细的逐步操作（含全部提示词原文、节点配置表、验收用例）见《Dify工作流搭建手册.md》**，照抄即可，全程约 1 小时。

后端已内置双平台支持，`lib/dify.js` 与 `lib/coze.js` 同签名，**切换不改业务代码**。
默认仍走扣子（`AI_PROVIDER=coze`），不配置 Dify 变量时行为与现在完全一致，可随时双向切换，两边互不干扰。

**当前识图契约**：`recognition.activities[]` 按日期保存每次跑步的完整指标和来源图片，`period_summaries[]` 保存周/月汇总；旧版 `metrics`、`runs` 仍可读。每次提交照旧生成一份新的 8 周计划。线上 Dify 工作流需按《Dify工作流搭建手册.md》同步后发布；仓库的 `dify-app-dsl.yaml` 是历史导出，不可直接覆盖线上版本。

1. **建或更新 Dify 工作流**：创建 Workflow 类型应用 → 模型供应商里配智谱 API Key → 节点及提示词以《Dify工作流搭建手册.md》为准：
   - 开始节点 5 个变量：`user_text`/`goal`/`race_date`/`history`（String）+ `images`（**file-list 类型，整组图片，不需要扣子那套 image1~10 拆分**）
   - 识图 LLM 节点：按活动与周/月汇总分开输出，不能把同一活动的多个页面重复计数
   - 诊断+计划 LLM 节点：按手册的目标和证据规则生成，每次恰好 8 周
   - 结束节点双输出：`recognition` + `diagnosis_result`（名字必须一致）
2. **拿密钥**：应用左侧"访问 API" → 创建 API 密钥（app- 开头）
3. **切换**：`.env` 里设 `AI_PROVIDER=dify`、`DIFY_API_KEY=app-xxx`（自托管另填 `DIFY_BASE_URL`），重启即生效；想回扣子改回 `AI_PROVIDER=coze` 即可
4. 图片走对象存储的 `remote_url` 方式传给 Dify，但**桶是私有的**：库里 `run_records.images` 存对象路径（`<user_id>/<文件名>`），每次诊断前由后端现签短期链接（`api/index.js` 的 `signImagePaths`），不依赖前端手里的 URL 是否新鲜
5. 响应用 streaming 模式聚合（blocking 模式有平台超时上限，跑不完 30-60 秒的工作流）

---

## 常见问题

- **启动报错 "未配置 Supabase 环境变量"**：`.env` 没填或没填对，检查第一、二步的值。
- **分析失败 "扣子工作流执行失败"**：检查 `COZE_WORKFLOW_ID`、`COZE_PAT` 是否正确，工作流是否已 Publish。
- **分析失败返回码 402**：次数用完；当前正式支付未接入，生产环境不显示模拟充值。
- **图片上传失败**：检查 Supabase Storage 私有桶及签名 URL；不要把健康图片桶设为 Public。
- **报告页显示"报告数据异常"**：扣子结束节点的输出不是 JSON。回到第二步检查结束节点是否按 `recognition` + `diagnosis_result` 两个变量输出，且两个节点输出格式都选了 JSON。
