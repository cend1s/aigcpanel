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

## 6. 分期计划

| 阶段 | 周期 | 内容 |
|---|---|---|
| P0 准备 | 1 周 | 客户端清理与配置(已完成入口隐藏、地址可配置、`userEnable`);后端骨架;登录 + `user_info` + `enter` 跑通 |
| P1 账号与钱包 | 2 周 | 注册登录完善、余额与流水、兑换码、管理后台基础 |
| P2 支付与会员 | 2 周 | 聚合支付 + Stripe、回调幂等、订单、套餐订阅、补单与对账 |
| P3 云端模型与计费 | 2–3 周 | 供应商抽象、`task/check`、预扣-结算-退款、超时兜底 |
| P4 业务功能 MVP | 3–4 周 | 智能体中心、文案(电商模板)、图片、口播、固定流水线 |
| P5 批量与增强 | 3–4 周 | 剪辑矩阵、视频模型、资产中心、邀请与签到 |
| P6 发布 | 1–2 周 | 打包、更新、压测、安全审查、live 残留清理 |
| 直播 | 另排期 | 见第 5 节 |
