import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// 供应商返回的图片 / 音频落盘，并以不可猜测的文件名对外提供下载。
// 文件名即访问凭证（128 位随机），不做登录校验；定期清理由部署侧负责（见 README）。
export const FILE_NAME_RE = /^[a-f0-9]{32}\.(png|jpg|webp|mp3|wav)$/;

export const createFileStore = (dir: string, baseUrl: string) => ({
    dir,
    save(buf: Buffer, ext: "png" | "jpg" | "webp" | "mp3" | "wav" = "png"): string {
        mkdirSync(dir, { recursive: true });
        const name = `${randomBytes(16).toString("hex")}.${ext}`;
        writeFileSync(join(dir, name), buf);
        return `${baseUrl.replace(/\/$/, "")}/files/${name}`;
    },
});

export type FileStore = ReturnType<typeof createFileStore>;
