# aigcpanel-backend

桌面端的账号、钱包、支付与云端模型后端（TypeScript + Fastify）。完整规划见 `../docs/project-notes.md`。

## 运行

```bash
cd backend
npm install
npm run dev          # 默认 http://127.0.0.1:3100
npm test             # 52 个测试（含桌面端云端驱动与后端的契约测试）
npm run typecheck
npx tsx scripts/create-admin.ts admin@example.com 'a-strong-password'   # 创建管理员
```

需要 Node >= 22.13。当前用内置 `node:sqlite`；切换 PostgreSQL 时替换 `src/db.ts` 及各模块的 SQL，业务规则不变。
开发联调可设 `PAYMENT_MOCK=1 MOCK_PROVIDER=1`，启用模拟支付页和模拟云端模型。

桌面端默认请求 `http://127.0.0.1:3100`，构建时可用 `VITE_BASE_URL` 覆盖。

## 模块

| 文件 | 职责 |
|---|---|
| `wallet.ts` | **唯一**的余额入账/扣减入口，每次变动写 `quota_ledger`；入账带钱包上限的原子 UPDATE |
| `funding.ts` | 预扣/释放/补扣：订阅额度优先，不足回落钱包，失败按来源各自退回 |
| `plans.ts` | 套餐、订阅开通（按订单去重、续购顺延）、功能权限下发 |
| `redeem.ts` | 兑换码，状态 CAS，只能用一次 |
| `pay/orders.ts` | 订单创建与统一完成逻辑：事务内锁定、通道与金额校验、CAS，重复/并发回调只入账一次 |
| `pay/providers/*` | 支付通道（`PaymentProvider` 接口）：`epay`（易支付协议）、`mock`（开发） |
| `cloud/tasks.ts` | 云端任务状态机：预扣 → 提交 → 结算/退款；兜底扫描 |
| `cloud/providers/*` | 云端模型供应商（`CloudProvider` 接口）：`openai-chat`（文本）、`openai-image`（文生图）、`mock` |
| `cloud/pricing.ts` | 计价：按次 / 按 token / 按单位，预估与结算 |

新增支付通道或模型厂商：实现对应接口，在 `src/index.ts` 注册即可，不影响计费与任务逻辑。

## 云端模型接入桌面端

桌面端已有的文生图、图生图、文生视频、图生视频页面通过 `electron/aigcserver/CloudServer.ts` 调用本后端：提交 → 轮询 → 下载结果文件，现有页面和任务流程无需改动。约定：

- **模型名称必须以 `Cloud` 开头**（如 `CloudImgGen`）。桌面端按前缀加载云端驱动，否则会被当作本地模型包加载而报错；`saveModel` 会校验。
- 模型 `functions` 里声明支持的功能（`textToImage` / `imageToImage` / `textToVideo` / `imageToVideo`，文案用 `textGen`），参数定义会下发给客户端渲染表单。
- 桌面端把任务 id 作为 `clientId` 提交：任务重试或应用重启后重新提交，后端返回同一个云端任务，**不会重复扣费**。
- 图生图/图生视频的参考图以 data URL 随请求提交（单张不超过 8MB）。
- 供应商返回 base64 时，图片落盘到 `FILES_DIR`，经 `GET /files/<32位随机名>.png` 提供下载（文件名即凭证，需自行定期清理旧文件）。

## 登录安全

| 机制 | 规则 |
|---|---|
| 图形验证码 | `svg-captcha` 本地生成，一次性，5 分钟有效，答案只存哈希。发送邮件验证码前必须通过；登录失败 3 次后必须通过。接口 `GET/POST /api/auth/captcha` |
| 邮件验证码 | 6 位数字，10 分钟有效，只存哈希；同邮箱同用途 60 秒一次、每天 10 次；输错 5 次作废；新码发出旧码作废。注册（`purpose=register`）与找回密码（`purpose=reset`）使用 |
| 防枚举 | 发码接口无论邮箱是否注册都返回相同提示；登录失败按邮箱计数，不存在的邮箱与存在的表现一致 |
| 登录保护 | 15 分钟内失败 3 次要求图形验证码，失败 8 次锁定 15 分钟（正确密码也不行） |
| 接口限流 | `@fastify/rate-limit`：全局每 IP 每分钟 600 次；登录 20、注册 10、发码 5、重置 10、图形验证码 30。超限返回 429 与中文提示 |
| 密码 | 8-128 位，必须同时包含字母和数字；重置密码后吊销该用户所有登录（含桌面端） |

页面:`/login`、`/register`、`/login?mode=forgot`（找回密码；用同一路径是为了在桌面端用户窗口内完成）、`/forgot`。

部署注意：
- **必须配置 SMTP**（见 `.env.example`），否则生产环境拒绝启动。
- 在反向代理后面时设 `TRUST_PROXY=1`，否则所有请求都被当成同一个 IP 限流。
- 限流计数在进程内存里，多实例部署时要改用 Redis 存储。
- 内置图形验证码能挡住简单脚本，挡不住专门的识别工具；遇到批量攻击时，按 `CaptchaService` 接口换成腾讯云、阿里云或 Cloudflare Turnstile 等托管验证码。

## 接口

客户端约定（桌面端已有调用）：

| 路径 | 说明 |
|---|---|
| `POST /api/app_manager/user_info` | 登录态与功能权限；token 无效时返回空用户，**绝不返回 1001** |
| `GET /api/app_manager/enter`、`user_web` | 系统浏览器/应用内窗口入口，`api_token` 换 cookie |
| `POST /api/server/all` | 云端模型清单（不含密钥与价格） |
| `POST /api/aigcpanel/task/check` | 提交前校验额度，不足返回 `data.type = "CreditNotEnough"` |
| `POST /api/aigcpanel/video_template/all\|get` | 暂返回空 |

业务接口（需登录，未登录返回 1001）：

- 账号：`/api/auth/register|login|logout`
- 钱包：`/api/account/balance|ledger|redeem`，`/api/plan/list`
- 支付：`/api/pay/methods|create|orders`，回调 `GET|POST /api/pay/notify/:provider`
- 云端任务：`/api/cloud/task/submit|status`（`submit` 支持 `clientId` 幂等）

管理后台界面见 `../admin/`（Refine + Ant Design，构建后由本服务托管在 `/admin/`）。

管理接口（`role >= 100`，否则 403），列表接口统一返回 `{ records, total }`：`/api/admin/` 下的 `me`、`stats`、`user/list|adjust-quota|set-status|ledger`、`redemption/create|list`、`plan/list|get|save`、`model/list|get|save|providers`、`order/list|complete`、`task/list`、`audit/list`。模型的密钥字段只返回脱敏值，保存时脱敏值或空值会保留原密钥。调额、补单、改模型都会写 `audit_logs`。

## 已知限制（上线前必须处理）

- **支付通道未联调真实网关**：`epay` 按公开协议实现并有签名测试，但没有接过真实商户，需用商户测试环境验证。
- **并发测试局限**：`node:sqlite` 是单进程同步的，当前的“并发回调只入账一次”测试验证的是事务与 CAS 逻辑；切到 PostgreSQL 后要在多连接下重新做并发测试。
- **订单过期**：未支付订单目前不会自动过期。
- **订阅**：只支持单周期额度，没有按月重置；订阅用完后总是回落钱包（没有“禁止回落”开关）。
- **视频模型**：只有同步的文本、图片供应商；视频厂商（异步轮询）的适配器尚未编写，但任务状态机、轮询、超时退款已支持异步供应商（见 `MockProvider` 的 `async` 模式）。
- **文本流式输出**：`openai-chat` 为非流式；文案写作的逐字展示需要另加流式接口。
- **登录**：没有手机号/短信验证码，没有第三方登录；邮件实际投递未在真实 SMTP 上验证。
- 登录页在 webview 内通过 `window.$mapi.user.save()` 回写桌面端登录态，依赖 preload 暴露 `$mapi`，需桌面端联调确认。
