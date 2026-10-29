import { readFileSync } from "node:fs";

// 服务端版本：打包时写在 server.mjs 旁边的 VERSION 文件里（CI 里为 r<运行序号>-<提交>），源码运行时为 dev
const read = () => {
    try {
        return readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim() || "dev";
    } catch {
        return "dev";
    }
};

export const SERVER_VERSION = read();
