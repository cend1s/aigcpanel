import fs from "node:fs";
import path from "node:path";

/**
 * 开发环境启动时把项目根目录的 .env 读入 process.env（已存在的变量不覆盖）。
 * 返回新加载的变量个数。vite.config.ts 在非发布构建时调用。
 */
export const loadDotEnv = (file = path.resolve(process.cwd(), ".env")): number => {
    if (!fs.existsSync(file)) return 0;
    let count = 0;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m || line.trim().startsWith("#")) continue;
        const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
        if (process.env[m[1]] === undefined) {
            process.env[m[1]] = value;
            count++;
        }
    }
    return count;
};
