# 营销一体化平台:项目笔记

基于 aigcpanel 改造为电商方向的营销一体化平台(文案、图片、视频、口播、剪辑矩阵)。
本文记录已确认的决策、调研结论和后续计划,供后续开发查阅。

## 1. 已确认的决策

| 项 | 决定 |
|---|---|
| 后端语言 | TypeScript(Node >= 22.13) |
| 目标行业 | 电商 |
| 收款 | 暂无微信/支付宝商户资质,先用聚合支付通道,支付层做成可替换接口 |
| 云端模型 | 做成可配置、可替换的供应商(文本/图片/视频/音频),单价规则存库 |
| 仓库私有化 | 暂不处理,由项目负责人后期自行操作(fork 的公开仓库不能直接改私有,需新建私有仓库后 mirror) |
| 直播 | 要做,但排在主线之后(见第 5 节) |

## 2. 现有客户端的账号机制(已读代码确认)

客户端不含账号和支付逻辑,全部委托后端,约定如下:

- 请求头 `Api-Token`,返回 `{code, msg, data}`,`code = 1001` 表示需要重新登录。
- `app_manager/user_info`:返回 `apiToken`、`user`、`data.functions`(功能权限)、`basic`(含 `userEnable`)。
  **此接口永远不能返回 1001**:客户端在收到 1001 时会调用 `refresh()`,而 `refresh()` 又调用本接口,会无限递归。未登录时应返回 code 0 与空用户。
- `app_manager/enter?api_token&device_uuid&url&is_dark`:在系统浏览器打开,用于登录、充值、会员页。
- `app_manager/user_web`:应用内用户窗口(webview)的入口。
- `server/all`:云端模型清单;`aigcpanel/task/check`:提交云端任务前校验额度(不足返回 `data.type = "CreditNotEnough"`)。
- `aigcpanel/video_template/all|get`:云端形象模板。
- `OfflineAuth` 是**模型启动包**的离线授权(启动器验签、绑定包名与机器码),不是软件本身的会员授权。会员权限走 `user_info.data.functions`。
- `src/config.ts` 的 `BASE_URL` 可由构建时 `VITE_BASE_URL` 覆盖,默认 `http://127.0.0.1:3100`。`userEnable` 已设为 `true`。

## 3. 开源项目调研结论

### new-api(QuantumNous/new-api,AGPLv3)
**只借鉴设计,不拷代码**(AGPL 会要求对网络用户开源后端;另有署名条款;商业授权需联系其方)。可借鉴:

1. 额度整数制 + 钱包上限,入账用带条件的原子 `UPDATE ... WHERE quota <= ?`。
2. 充值订单 `trade_no` 唯一;回调在事务内锁订单行、校验渠道一致、已成功则幂等返回,状态与余额同一事务更新。
3. 回调验签;易支付成功回 `success`、失败回 `fail`;Stripe 只在 `status=complete` 且 `payment_status=paid` 时入账,并处理异步支付成功、失败、过期。
4. 兑换码:用 `WHERE status = enabled` 的 UPDATE 做 CAS,看 `RowsAffected`;兑换前随机延迟防枚举。
5. 订阅:套餐、订单、用户订阅(额度、起止、周期重置、到期降级);订阅额度用完可回落到钱包。
6. 计费会话:预扣 → 按实际结算 → 失败退款,幂等。
7. 邀请返利、每日签到、用户分组折扣、手动补单、审计日志。

我们的改进:独立 `quota_ledger` 流水表;任务级计费要持久化(异步长任务,含超时兜底扫描),不能只放内存。

### Fay(xszyou/Fay,GPLv3)
数字人**对话交互框架**(LLM、记忆、MCP、ASR/TTS、自动播报),不含弹幕抓取、RTMP 推流、口型合成。不拷代码(GPL),可借鉴:

- 用户交互优先于自动播报,交互后暂停自动播报 30 秒(`core/fay_core.py` 的 `can_auto_play`)。
- 流式分句播报(`utils/stream_sentence.py`)。
- 问答对优先、大模型兜底(`qa_service.py` / `qa.csv`)。
- 按用户隔离上下文与记忆。

### 支付与授权的其他候选(搜索得到,未核实)
- 聚合支付:DaxPay、Jeepay(国产开源,收单/退款/对账/分账)。
- 桌面授权:Keygen CE(source-available)、Keygate(Go,AGPL);托管方案 Lemon Squeezy、Polar。
- 账号:Casdoor、Logto;计费:Lago(AGPL)、Kill Bill(Apache-2.0)。

## 4. 后端设计要点

- 技术栈:TypeScript + Fastify;P0 骨架用 `node:sqlite`,P1 起切 PostgreSQL + Redis(数据访问放在独立模块,便于替换)。
- 所有余额变动经单一入口,同时写 `quota_ledger`;禁止业务代码直接改 `quota`。
- Api-Token 只存哈希;token 绑定设备;改密后令旧 token 失效(参考 new-api 的 `auth_version`)。
- 支付通道、云端模型供应商均抽象为接口,可替换。
- `enter` 的 `url` 参数只允许站内相对路径,防开放重定向。

## 5. 直播方案(后期实施)

### 现状(已读代码确认)
- 开源仓库只有控制层:`src/store/modules/live.ts`、`LiveAvatarService`、`httpserver/routes/live.ts`(`POST /api/live/tts`)、`live_avatar` 表、`PageMonitor.vue`(弹幕监听窗口壳)。
- 缺失:`src/pages/Live/` 整个目录(界面、`util.ts` 的 `EventTypes`、多语言词条)、弹幕监听脚本(原由后端 `server/live_monitor_script` 下发)、直播引擎本体。
- 引擎是 `functions` 含 `live` 的模型启动包,客户端经 `callFunction(serverInfo, "apiRequest", {url, param})` 调用:`status`、`config`、`scene/start`、`scene/update`、`scene/stop`、`scene/talk`、`scene/event`。引擎回调客户端 `/api/live/tts`(只传 `voiceId` 与文本)合成语音;引擎输出 RTMP/HLS 地址。
- 当前入口已从导航、首页、路由隐藏,页面文件与 `live.ts` 未删除。`VoiceSelector`、`server.ts`、`task.ts` 仍引用 live,清理放到 P6。

### 三块待建
| 块 | 内容 | 估算 |
|---|---|---|
| A 前端界面 | 重建 `Live.vue` 各标签:监控、控制台、形象、知识库(循环视频/循环话术/关键词回复/系统事件)、音色、互动事件、播报历史;补 `pages/Live/util.ts` 与词条 | 1.5–2 周 |
| B 直播引擎 | 实现上述 7 个 `apiRequest`;事件优先级队列(弹幕回复 > 手动播报 > 循环话术)、问答对优先加大模型兜底、流式分句播报、调用 `/api/live/tts`、推流 | 路线 1:约 2 周;路线 2:3–5 周 |
| C 弹幕适配器 | 抖音、B站、虎牙、斗鱼、快手,统一输出 `{type: Enter/Like/Comment, data}` | 每平台 3–5 天,需持续维护 |

引擎路线:
1. 音频模式(无需 GPU):循环视频 + TTS 音频,FFmpeg 推流。先上线。
2. 实时口型(Wav2Lip/MuseTalk):需显卡。优先评估集成 LiveTalking。
3. 第三方云端数字人。

风险:弹幕抓取依赖页面或私有协议,随时失效,且可能违反平台条款,应作为可选插件并提示风险;电商直播涉及违禁词与广告法。

### 调研到的开源参考(均未克隆核实,授权需自行确认)
- **LiveTalking**(`lipku/LiveTalking`,原 metahuman-stream):wav2lip/musetalk/ernerf,声音克隆,打断,RTMP/WebRTC/虚拟摄像头。引擎底座首选候选;**授权待确认**。
- 弹幕抓取:`wbt5/real-url`(GPL-2.0,斗鱼/虎牙/B站/抖音/快手等)、Gitee 上基于 Netty 的通用弹幕客户端、`XiaoXinYo/Live-Barrage` 的 fork、抖音网页版弹幕工具(WebSocket + Protobuf)。仅参考协议解析,不依赖。
- AI 主播整体:ZerolanLiveRobot、ChatGPT-Virtual-Live(B站/抖音/视频号评论 + Edge TTS + OBS)、Open-LLM-VTuber(后端 MIT)、AI-VTuber-System、AI-YinMei、awesome-ai-vtubers 合集。多为 Live2D 形象,参考互动与调度逻辑。

### 下一步(排期到主线之后)
1. 克隆 LiveTalking,核实授权、接口、推流方式、显存要求,出集成方案。
2. 恢复直播入口,重建 `pages/Live`。
3. 先写一个纯 Node 的模拟引擎(实现 7 个接口的假数据),验证客户端流程并作为接口规范。
4. 引擎路线 1 → 抖音弹幕适配器 → 路线 2。

### 5.1 LiveTalking 核实结果(2026-10-29,克隆 c726943)

- **授权**:Apache-2.0,可商用、可改。但 README「声明」要求:基于它发布到 B站/视频号/抖音等平台的视频需带 LiveTalking 水印和标识。直播是否适用需向作者确认,按需要带水印来规划。
- **能力**:wav2lip / musetalk / ultralight 口型;TTS 插件(edge、sovits、cosyvoice、腾讯、豆包等);输出 webrtc / rtmp / 虚拟摄像头;待机时播放自定义视频(动作编排);可打断。
- **接口**(`docs/api.md`,统一 `{code,msg,data}`):`/human`(文本,echo 或 chat,可 interrupt)、`/humanaudio`(上传音频驱动)、`/interrupt_talk`、`/is_speaking`、`/set_audiotype`、`/record`、`/sse`(播报状态推送)。另有 `/avatar.html` 与 avatar_api:上传视频生成形象。
- **RTMP / 虚拟摄像头模式**:启动参数 `--transport rtmp --push_url ...`,固定会话 `sessionid=0`,启动即开始渲染。
- **硬件**:wav2lip256 推荐 RTX 3060 以上(60fps);musetalk 推荐 RTX 3080Ti 以上(42fps);推理帧率需 ≥25 才算实时。Python 3.12 + CUDA 12.8,Windows 有作者的整合包。

### 5.2 推荐架构(待确认)

- **场景逻辑放在我们自己的 TypeScript 里**:在主进程实现内置「直播引擎」驱动(与 CloudServer 同类,`functions` 含 `live`),实现客户端已用的 7 个 `apiRequest`。它负责循环话术、关键词回复、进场/点赞/评论事件、手动播报、大模型兜底、优先级队列与打断,并用现有 `/api/live/tts` 的合成逻辑生成音频。
- **LiveTalking 只当渲染器**:引擎把合成好的音频经 `/humanaudio` 发给 sessionid=0,用 `/is_speaking`、`/sse` 控制节奏。以后换别的渲染器只改这一层。
- **无显卡模式**:循环视频 + 语音,FFmpeg 输出,作为第一阶段。
- **出画方式**:抖音推流码(RTMP)不是所有账号都有,通用做法是虚拟摄像头或窗口采集,再接「抖音直播伴侣」或 OBS。
- **弹幕**:官方监听脚本由其后端下发(`server/live_monitor_script`),我们没有,需要自己写。在直播间网页里监听评论区的页面变化,比解析私有协议简单,但页面改版会失效。

### 5.4 进度
- **第一轮（已完成）**：恢复「直播」入口与左侧菜单；直播知识库（循环口播 / 用户知识 / 系统事件 / 循环内容视频，增删改、启停、批量删除、AI 扩写同义话术、违禁词提示与一键检测、违禁词库可在页面里改）；直播音色（复用音色管理）；直播形象（复用数字人形象）；直播互动、播报历史列表。纯逻辑在 `src/pages/Live/util.ts`、`config/blackWord.ts`，测试 `src/pages/Live/live.test.ts`。
- 上游开源仓库的直播从来只有外壳（主体在闭源 Pro 版）；复用了其中的违禁词库、AI 扩写提示词，高亮改为先转义防注入。
- **第二轮（已完成）**：直播控制台（开播/停播、音色、画面内容与比例、字幕、循环口播顺序与间隔、默认称呼、欢迎间隔、手动插播、模拟观众互动、待播队列、最近播报、提示、直播伴侣开播说明）；直播引擎 `src/pages/Live/engine.ts`（弹幕回复 > 手动插播 > 系统事件 > 循环口播，提前合成、每类排队上限、进场与点赞冷却、违禁词跳过，测试 `engine.test.ts`）；运行时 `runtime.ts`（直播音色合成、播报历史、知识库每 15 秒热更新）；直播画面窗口 `live-stage`（形象视频循环或商品视频轮播，字幕，窗口标题固定为「AigcPanel 直播画面」供直播伴侣窗口采集）。
- 顺带修复：主窗口 `backgroundThrottling` 原来写在 webPreferences 外面不生效，最小化后定时器会被降速。
- 旧的 `src/store/modules/live.ts`（对接闭源引擎的 7 个接口）不再使用，暂未删除。
- **下一轮**：抖音弹幕监听（直播间网页 + 页面变化监听，输出进入/点赞/评论/关注/送礼，接 `liveViewerEvent`）；之后评论未命中关键词时的大模型兜底回复；最后接 LiveTalking 实时口型。

### 5.3 风险
- 抖音等平台对「无人直播 / AI 数字人直播」有规则(需声明 AI 生成、限制录播式循环),违规可能限流或封号,上线前要核对平台规范。
- 官方「直播一键运行包」是闭源引擎,很可能要向 aigcpanel.com 校验授权,在本项目里大概率用不了,所以引擎要自己做。

## 6. 分期计划

| 阶段 | 周期 | 内容 |
|---|---|---|
| P0 准备 | 1 周 | **已完成**:入口隐藏、地址可配置、`userEnable`;后端骨架;登录 + `user_info` + `enter` |
| P1 账号与钱包 | 2 周 | **后端已完成**:余额与流水、兑换码、用户中心网页、管理接口(无管理界面);缺:验证码、找回密码、登录限流 |
| P2 支付与会员 | 2 周 | **后端已完成(除 Stripe/对账)**:易支付协议(未联调)、回调幂等、订单、套餐订阅、人工补单;缺:Stripe、官方微信/支付宝、每日对账、订单过期 |
| P3 云端模型与计费 | 2–3 周 | **后端已完成**:供应商抽象、`task/check`、预扣-结算-退款、兜底扫描、OpenAI 兼容文本供应商;缺:图片/视频厂商适配、桌面端提交云端任务的对接 |
| P4 业务功能 MVP | 3–4 周 | **进行中**:已完成「电商文案」(6 个模板,云端文本模型,历史记录,按次扣费);待做:图片/视频/口播的云端模式、智能体中心首页、固定流水线 |
| P5 批量与增强 | 3–4 周 | 剪辑矩阵、视频模型、资产中心、邀请与签到 |
| P6 发布 | 1–2 周 | 打包、更新、压测、安全审查、live 残留清理 |
| 直播 | 另排期 | 见第 5 节 |

## 7. 实现进度与未完成项(2026-10)

后端 `backend/` 已实现 P0–P3 的核心(31 个测试通过,浏览器端到端验证了注册→充值→到账)。详见 `backend/README.md` 的“已知限制”。

**桌面端已完成**:`Apps/EcomCopy`(电商文案,入口在「工具」页第一组「营销创作」)、`service/CloudService.ts`(提交云端任务并轮询,额度不足引导充值)。已在浏览器测试台(桩 `$mapi` + 真实后端)验证:模板、必填校验、生成、扣费、额度不足提示、历史记录;未在真实 Electron 中运行。

**尚未开始**:P4 其余部分(智能体中心首页、图片/视频/口播的云端模式接入、流水线)、P5 剪辑矩阵/资产中心、管理后台界面、桌面端联调(webview 登录回写、云端任务提交)、真实支付网关联调、直播(第 5 节)。

### 7.1 图片/视频生成:复用原项目,补云端驱动(2026-10)

原项目已有完整的文生图、图生图、文生视频、图生视频页面和任务流程(`Apps/TextToImage` 等,经 `serverStore` 调用模型)。**缺的不是页面,而是云端模型的执行驱动**:`electron/mapi/server/main.ts` 对名称以 `Cloud` 开头的模型执行 `new AigcServer["Cloud"]()`,但 `aigcserver/index.ts` 没有导出它(闭源),所以云端模型一调用就报错。

已补:
- `electron/aigcserver/CloudServer.ts` + `cloud/runner.ts`:提交 → 轮询 → 下载结果,返回与本地模型一致的 `{type:"success", data:{url}}`;任务 id 作 `clientId` 幂等;本地参考图转 data URL。
- 后端:`openai-image` 供应商、`/files` 下载、`clientId` 去重、模型名必须以 `Cloud` 开头。
- 验证:runner 单元测试(5)、驱动↔真实后端 HTTP 契约测试(扣费、重试不重复扣费、额度不足、上游失败退款)。**未在真实 Electron 里点过现有图片页面**。

仍缺:视频厂商适配器(异步)、图生图等真实厂商联调、`ServerCloudRecord.functions` 的参数表单定义需与各厂商参数对齐。

### 7.1.1 云端语音合成 / 语音识别(2026-10)

- 后端 `cloud/providers/openaiAudio.ts`:`openai-tts`(`/audio/speech`,音频落盘经 `/files` 下载,用量=字数)、`openai-asr`(multipart 上传 `/audio/transcriptions`,`verbose_json` 分段转成毫秒 `{records:[{start,end,text}]}`,用量=秒或分钟)。`mock` 供应商对 `soundTts`/`asr` 返回静音 wav / 固定文本,便于演示。
- 计价:`per_unit` 的 `unit` 为 `char` 时按文本长度预扣,为 `minute` 时按时长换算;结算按上游实际用量多退少补。
- 桌面端 `CloudServer` 新增 `soundTts`、`asr`;识别前用 ffmpeg 转 16kHz 单声道 32kbps mp3(≤10MB,约 40 分钟)再以 data URL 上传。
- 验证:后端测试 56 个通过;runner 单元测试 7 个;真实 Electron 中经 `serverStore.call` 调用云端 TTS(拿到本地 wav)与 ASR(拿到 records)均成功。
- 未做:声音克隆(`soundClone`)的云端版、长音频自动分段。

### 7.2 文案 → 配音 → 口播视频:原项目已有「一键合成」,只补衔接(2026-10)

原项目的 `Apps/VideoGenFlow`(「一键合成流程」,`/video?tab=VideoGenFlow`)本来就是 文本 → 配音 → 数字人视频,另有 `LongTextTts`(长文本转音频)。因此**不新写流水线**,只让电商文案页把结果送过去:

- `EcomCopy/handoff.ts`:把文案整理成适合朗读的文本(去话题标签、表情、Markdown、链接),写入目标页的 localStorage 草稿(`VideoGenFlowCreate.formData` / `LongTextTtsCreate.formData`),再跳转;目标页挂载时读取草稿作为初始文本。
- `handoff.test.ts` 会读取目标页源码,校验草稿 key 仍然存在,防止上游改名后悄悄失效。
- 注意:原项目已有 `ModelAgentButton`(用本地配置的文本模型生成文案);本项目的「电商文案」是云端计费、带电商模板的版本,两者并存。
- 已在浏览器测试台验证两个按钮的草稿内容;**未在真实 Electron 里验证跳转后目标页的显示**。

### 7.3 管理后台(2026-10)

选型:**Refine 5 + Ant Design 5**(MIT,专门做增删改查后台;数据层对接现有 `/api/admin/*`,不直连数据库,流水与审计不会被绕开)。Directus、NocoDB 这类直连数据库的低代码工具因会绕开业务规则而排除。

- 位置 `admin/`,构建后由后端托管在 `/admin/`;首个管理员用 `backend/scripts/create-admin.ts` 创建。
- 页面:概览、用户(调额/流水/禁用)、订单(人工补单)、兑换码(批量生成)、套餐、云端模型(密钥脱敏)、云端任务、审计日志;Refine 内置文案已中文化。
- 后端补充:列表统一 `{records,total}`、`admin/me|stats|task/list|audit/list|user/ledger|model/list|get|providers|plan/get`;LIKE 搜索正确转义通配符;禁止禁用自己;`@fastify/static` 用 10.1.8(低版本有路径穿越漏洞)。
- 验证:后端 42 个测试;浏览器端到端 10 步(非管理员被拒、调额、流水、补单、生成兑换码、建套餐、建/改模型且密钥保留、审计)。

### 7.4 登录安全(2026-10)

- 图形验证码(svg-captcha,可换托管验证码)、邮件验证码(nodemailer + SMTP;开发环境打印到日志)、找回密码、登录失败锁定、接口限流(@fastify/rate-limit)、密码强度、重置后吊销所有登录、防账号枚举。规则见 `backend/README.md`「登录安全」。
- 网页:登录页失败 3 次后出现图形验证码;注册页图形验证码 + 邮件验证码 + 60 秒倒计时;找回密码页。管理后台换成支持图形验证码的自定义登录页。
- 依赖:nodemailer 10.1.7(10.1.3 及以下有地址解析安全公告)、@fastify/rate-limit 11.2.0、svg-captcha 1.4.0;`npm audit` 为 0。
- 验证:后端 52 个测试;浏览器端到端 10 步(注册、登录失败出验证码、找回密码、管理后台验证码登录)。过程中发现并修复:管理后台请求验证码用 POST 而接口只开放 GET;登录失败通知把内部错误类型展示给用户;弱密码会白白消耗验证码。
- 未做:短信验证码、第三方登录、真实 SMTP 投递验证、多实例限流(需 Redis)。

### 7.5 剪辑矩阵(2026-10)

入口:「工具」→「营销创作」→「剪辑矩阵」(`src/pages/Apps/ClipMatrix/`)。多段素材视频 × 多段文案 × 多个音色,批量生成不重复的短视频。

- 规划(`plan.ts`,纯函数):文案与音色轮流分配,素材随机排列且组合不重复;可选轻微变速(0.95~1.05)、放大裁切(1~1.08)、随机镜像以降低重复度;同一 seed 结果可复现;不重复组合不够时如实少出并提示。单批最多 200 条。
- 渲染(`render.ts`,纯函数):片段覆盖配音时长、素材太短时循环;统一缩放裁切到目标比例(9:16/16:9/1:1/3:4);ffmpeg 输出 H.264 + AAC,时长以配音为准。
- 任务(`task.ts`,biz `ClipMatrix`):配音复用「长文本转音频」子任务(自动分段) → ffmpeg 合成 → 字幕复用「视频添加字幕」子任务(用文案按字数比例生成 SRT)。子任务用轮询等待,重启后可续;合成与字幕各限并发 2,防止一次几十个 ffmpeg 拖垮机器。
- 字幕不用 ffmpeg 的 `subtitles` 滤镜:原项目的字幕走 WebAV,推测打包的 ffmpeg 不含 libass。
- 验证:7 个单元测试,其中一个用真实 ffmpeg 把三段不同尺寸、无音轨的素材加配音合成为目标尺寸、时长等于配音的成片;类型检查无新增错误;测试台中页面渲染、文案分段识别、校验提示正常。**未在真实 Electron 中跑完整的批量任务**(配音、子任务衔接、字幕需要本地模型或云端音色)。
- 已知局限:字幕时间按字数比例估算,不是逐字对齐;没有背景音乐、转场、片头片尾。

### 7.6 资产中心(2026-10)

入口:左侧导航「资产」(`/assets`,`src/pages/Assets/`)。统一管理视频、图片、音频、文案。

- 存储:复用通用的 `data_storage` 表(biz = `Asset`),不改数据库结构。媒体字段用 `content.file`(不用 `url`,因为 `StorageService.delete` 会自动删 `url` 指向的文件)。
- 导入文件:复制到软件自己的存储目录(hub),原文件删除或移动后仍可用;自动识别类型、读取时长。删除时一并删除这些"持有"的文件。
- 收录生成结果:一键把文生图、图生视频、口播视频、剪辑矩阵、配音等已完成任务的结果收进来;只是引用,删除资产不删原结果;已收录的不重复。
- 文案资产:手动新建,或在「电商文案」结果处点「存入资产中心」。
- 标签(空格/逗号分隔,去重,最多 10 个)、按类型/标签/关键字筛选、编辑、分页。
- 剪辑矩阵可「从资产中心选择」素材视频与文案(`AssetPicker.vue`)。
- 验证:纯逻辑 4 个测试;测试台中实际操作新建、标签筛选、搜索、编辑、删除,以及剪辑矩阵从资产中心导入文案和视频。**导入本地文件与打开文件依赖 Electron 文件对话框,未在真实桌面端验证**。
