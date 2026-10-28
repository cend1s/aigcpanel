# aigcpanel-backend

桌面端的账号与付费后端（TypeScript + Fastify）。当前为 P0 骨架：注册登录、`user_info`、`enter`、`user_web` 和最小网页。
完整规划见 `../docs/project-notes.md`。

## 运行

```bash
cd backend
npm install
npm run dev        # 默认 http://127.0.0.1:3100
npm test
```

需要 Node >= 22.13（使用内置 `node:sqlite`；P1 起切换 PostgreSQL）。

## 对接桌面端

桌面端默认请求 `http://127.0.0.1:3100`（`src/config.ts`），构建时可用 `VITE_BASE_URL` 覆盖。

已实现的客户端约定接口：

| 路径 | 说明 |
|---|---|
| `POST /api/app_manager/user_info` | 返回登录态；token 无效时返回空用户，**绝不返回 1001** |
| `GET /api/app_manager/enter` | 系统浏览器入口，`api_token` 换 cookie 后跳转站内页 |
| `GET /api/app_manager/user_web` | 应用内用户窗口入口 |
| `POST /api/auth/register`、`/login`、`/logout` | 账号 |

登录页在 webview 中通过 `window.$mapi.user.save()` 把登录态写回桌面端（依赖 webview preload 暴露 `$mapi`，需在桌面端联调确认）。
