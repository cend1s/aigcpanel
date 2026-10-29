// 把服务端（后端 + 管理后台 + 便携版 Node）打成可直接解压运行的本地部署包。
//
// 用法：node backend/packaging/pack.mjs --platform win-x64|darwin-arm64|darwin-x64|linux-x64 [--out dist-server]
//
// 产物：<out>/aigcpanel-server-<platform>.zip，内含
//   node/         便携版 Node 22（后端使用内置 node:sqlite，需要 22.13 以上）
//   server/       打包后的后端（server.mjs、create-admin.mjs）与生产依赖
//   admin/dist/   管理后台静态文件（后端自动挂载到 /admin/）
//   启动脚本、创建管理员脚本、使用说明
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(here, "..");
const rootDir = resolve(backendDir, "..");
const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const platform = args.platform ?? "win-x64";
const outDir = resolve(rootDir, args.out ?? "dist-server");
const PLATFORMS = ["win-x64", "darwin-arm64", "darwin-x64", "linux-x64"];
if (!PLATFORMS.includes(platform)) throw new Error(`--platform 需为 ${PLATFORMS.join(" / ")}`);
const isWin = platform.startsWith("win");

const run = (cmd, cwd = rootDir) => {
    console.log(`+ ${cmd}`);
    execSync(cmd, { cwd, stdio: "inherit" });
};

const stage = join(outDir, `aigcpanel-server-${platform}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// 1. 管理后台
run("npm ci", join(rootDir, "admin"));
run("npm run build", join(rootDir, "admin"));
cpSync(join(rootDir, "admin", "dist"), join(stage, "admin", "dist"), { recursive: true });

// 2. 后端：应用代码打成单文件，第三方依赖保留在 node_modules（svg-captcha 运行时要读字体文件）
run("npm ci", backendDir);
const esbuild = "npx esbuild --bundle --platform=node --format=esm --target=node22 --packages=external";
run(`${esbuild} src/index.ts --outfile=${join(stage, "server", "server.mjs")}`, backendDir);
run(`${esbuild} scripts/create-admin.ts --outfile=${join(stage, "server", "create-admin.mjs")}`, backendDir);
const pkg = JSON.parse(readFileSync(join(backendDir, "package.json"), "utf8"));
writeFileSync(
    join(stage, "server", "package.json"),
    JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", dependencies: pkg.dependencies }, null, 2),
);
cpSync(join(backendDir, "package-lock.json"), join(stage, "server", "package-lock.json"));
run("npm ci --omit=dev --ignore-scripts", join(stage, "server"));

// 3. 便携版 Node 22（取最新的 22.x LTS）
const index = JSON.parse(execSync("curl -fsSL https://nodejs.org/dist/index.json").toString());
const version = index.find((v) => v.version.startsWith("v22.") && v.lts).version;
const nodeName = { "win-x64": "win-x64", "darwin-arm64": "darwin-arm64", "darwin-x64": "darwin-x64", "linux-x64": "linux-x64" }[platform];
const archive = `node-${version}-${nodeName}.${isWin ? "zip" : "tar.gz"}`;
const tmp = join(outDir, "_node");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
run(`curl -fsSL -o ${archive} https://nodejs.org/dist/${version}/${archive}`, tmp);
run(isWin ? `unzip -q ${archive}` : `tar -xzf ${archive}`, tmp);
const nodeDir = join(tmp, archive.replace(/\.(zip|tar\.gz)$/, ""));
if (isWin) {
    mkdirSync(join(stage, "node"), { recursive: true });
    cpSync(join(nodeDir, "node.exe"), join(stage, "node", "node.exe"));
} else {
    mkdirSync(join(stage, "node", "bin"), { recursive: true });
    cpSync(join(nodeDir, "bin", "node"), join(stage, "node", "bin", "node"));
}
rmSync(tmp, { recursive: true, force: true });

// 4. 启动脚本与说明（本地试用默认：模拟支付、模拟模型、注册不强制邮件验证码）
const env = {
    PORT: "3100",
    HOST: "127.0.0.1",
    DB_FILE: "../data/app.db",
    FILES_DIR: "../data/files",
    ADMIN_DIR: "../admin/dist",
    PAYMENT_MOCK: "1",
    MOCK_PROVIDER: "1",
    REQUIRE_EMAIL_CODE: "0",
};
if (isWin) {
    const setEnv = Object.entries(env).map(([k, v]) => `set ${k}=${v}`).join("\r\n");
    writeFileSync(
        join(stage, "启动服务端.bat"),
        `@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0server"\r\n${setEnv}\r\necho 服务端启动中：http://127.0.0.1:3100  管理后台：http://127.0.0.1:3100/admin/\r\necho 关闭本窗口即停止服务。\r\n"..\\node\\node.exe" --no-warnings server.mjs\r\npause\r\n`,
    );
    writeFileSync(
        join(stage, "创建管理员.bat"),
        `@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0server"\r\nset DB_FILE=${env.DB_FILE}\r\nset /p EMAIL=管理员邮箱：\r\nset /p PASS=管理员密码（8位以上，含字母和数字）：\r\n"..\\node\\node.exe" --no-warnings create-admin.mjs "%EMAIL%" "%PASS%"\r\npause\r\n`,
    );
} else {
    const exportEnv = Object.entries(env).map(([k, v]) => `export ${k}=${v}`).join("\n");
    writeFileSync(
        join(stage, "start.sh"),
        `#!/bin/bash\ncd "$(dirname "$0")/server"\n${exportEnv}\necho "服务端：http://127.0.0.1:3100  管理后台：http://127.0.0.1:3100/admin/  （Ctrl+C 停止）"\nexec ../node/bin/node --no-warnings server.mjs\n`,
        { mode: 0o755 },
    );
    writeFileSync(
        join(stage, "create-admin.sh"),
        `#!/bin/bash\ncd "$(dirname "$0")/server"\nexport DB_FILE=${env.DB_FILE}\nread -p "管理员邮箱：" EMAIL\nread -s -p "管理员密码（8位以上，含字母和数字）：" PASS; echo\nexec ../node/bin/node --no-warnings create-admin.mjs "$EMAIL" "$PASS"\n`,
        { mode: 0o755 },
    );
}
cpSync(join(here, "README.txt"), join(stage, "使用说明.txt"));

// 5. 压缩
const zip = `aigcpanel-server-${platform}.zip`;
rmSync(join(outDir, zip), { force: true });
run(`zip -qry ${zip} aigcpanel-server-${platform}`, outDir);
console.log(`\n完成：${join(outDir, zip)}（Node ${version}）`);
