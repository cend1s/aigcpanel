# 本地拉取与运行

这份说明给「把整个项目拉到自己电脑」用。三种用法，按需选：

| 用法 | 适合 | 需要什么 |
|---|---|---|
| A. 直接用打包好的安装包 | 只想试用 | 不需要装开发环境 |
| B. 拉源码，本地开发运行 | 想改代码、调试 | Node、Git |
| C. 拉源码，自己打安装包 | 不想等 GitHub | Node、Git，Windows 上还要 Visual Studio 生成工具 |

## 一、拉代码

工作分支是 `claude/nifty-rubin-ix03iu`（所有改动都在这条分支上，还没有合并到 `main`）。

```bash
git clone -b claude/nifty-rubin-ix03iu https://github.com/cend1s/aigcpanel.git
cd aigcpanel
```

以后更新：

```bash
git pull origin claude/nifty-rubin-ix03iu
```

## 二、用法 A：下载打包好的安装包

1. 打开仓库的 Actions → 「Local Trial Build」，点最新一次成功的运行。
2. 页面最下面的 Artifacts 里下载：
   - `AigcPanel-desktop-win-x64-r<序号>`：桌面端安装包（Windows）
   - `aigcpanel-server-win-x64-r<序号>`：服务端（Windows）
   - 苹果芯片的 Mac 对应 `…mac-arm64…` 和 `…darwin-arm64…`
3. 服务端：解压，双击 `启动服务端.bat`；第一次先双击 `创建管理员.bat`。升级时覆盖安装目录，**保留 `data` 文件夹**。
4. 桌面端：运行安装包，从桌面的「AigcPanel电商版」打开。标题栏的 `r<序号>` 要和服务端窗口里打印的版本一致。

## 三、用法 B：本地开发运行

环境：**Node 22.13 以上**（服务端用了内置的 `node:sqlite`）、Git。

### 1. 服务端（后端 + 管理后台）

```bash
cd backend
npm ci
# 本地试用：模拟支付、模拟模型、注册不要邮件验证码
# macOS / Linux
PAYMENT_MOCK=1 MOCK_PROVIDER=1 REQUIRE_EMAIL_CODE=0 npm run dev
```

Windows（PowerShell）：

```powershell
cd backend
npm ci
$env:PAYMENT_MOCK="1"; $env:MOCK_PROVIDER="1"; $env:REQUIRE_EMAIL_CODE="0"; npm run dev
```

默认监听 `http://127.0.0.1:3100`，数据库在 `backend/data/app.db`。创建管理员：

```bash
cd backend
npx tsx scripts/create-admin.ts 你的邮箱 你的密码
```

管理后台：

```bash
cd admin
npm ci
npm run dev      # 打开 http://localhost:5173/admin/ ，接口自动转发到 3100
```

### 2. 桌面端

```bash
# 项目根目录
npm install                 # 会自动编译原生依赖，第一次比较慢
bash scripts/init.sh        # 下载 ffmpeg / ffprobe（Windows 用 Git Bash 运行）
npm run dev                 # Windows 用 npm run dev:win ；macOS 用 npm run dev:mac
```

桌面端默认连 `http://127.0.0.1:3100`。要连别的地址，启动前设置 `VITE_BASE_URL`。

### 3. 测试

```bash
cd backend && npm test                                   # 服务端
./backend/node_modules/.bin/tsx --test src/pages/Live/*.test.ts   # 直播
```

## 四、用法 C：自己打安装包

```bash
npm install
bash scripts/init.sh
npx cross-env VITE_RELEASE=1 npx vite build
node scripts/gen-electron-builder-config.mjs
npx electron-builder --config _temp/electron-builder-native-config.json --win --publish never
# macOS 把 --win 换成 --mac；产物在 dist-release/
```

> 不要用 `npm run build`：里面会先跑 `prettier --write` 改写源码，并且 electron-builder 会尝试发布到 GitHub。

服务端打包：

```bash
node backend/packaging/pack.mjs --platform win-x64 --out dist-server
# 平台可选 win-x64 / darwin-arm64 / linux-x64；需要能下载 Node 和 npm 依赖
```

## 五、目录速查

| 目录 | 内容 |
|---|---|
| `src/` | 桌面端界面（Vue3）；直播在 `src/pages/Live/`，电商文案 `src/pages/Apps/EcomCopy/`，剪辑矩阵 `src/pages/Apps/ClipMatrix/` |
| `electron/` | 桌面端主进程；云端模型驱动 `electron/aigcserver/CloudServer.ts` |
| `backend/` | 服务端（账号、额度、支付、云端模型调用）；说明见 `backend/README.md` |
| `admin/` | 管理后台（Refine + Ant Design） |
| `docs/project-notes.md` | 决策、调研、直播方案与各阶段进度 |
| `.github/workflows/local-build.yml` | 打包流程（只手动触发） |
