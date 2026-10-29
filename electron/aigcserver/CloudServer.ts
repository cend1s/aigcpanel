import fs from "node:fs";
import path from "node:path";
import { Files } from "../mapi/file/main";
import { Log } from "../mapi/log/main";
import {
    SendType,
    ServerApiType,
    ServerFunctionDataType,
    ServerInfo,
} from "../mapi/server/type";
import { UserApi } from "../mapi/user/main";
import { CloudRunDeps, runCloudFunction } from "./cloud/runner";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// 语音识别上传前统一转成 16kHz 单声道低码率 mp3（1 小时约 14MB），兼容视频文件并控制请求体积
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
};

/**
 * 云端模型（名称以 Cloud 开头）的 ServerContext。
 *
 * 没有本地进程：把任务交给后端 cloud/task 接口（后端负责预扣、调用上游模型、结算/退款），
 * 轮询到结果后把文件下载到本地，返回与本地模型一致的 { type: "success", data: { url } }，
 * 因此文生图、图生图、文生视频、图生视频等现有页面和任务流程无需改动。
 * 语音合成（soundTts）同样返回音频 { url }；语音识别（asr）返回 { records }，与本地识别模型一致。
 */
export const CloudServer = function (this: any) {
    const me = this;
    this.ServerApi = null as ServerApiType | null;
    this.ServerInfo = null as ServerInfo | null;
    let cancelled = false;

    this.send = function (this: any, type: SendType, data: any) {
        this.ServerApi.event.sendChannel(this.ServerInfo.eventChannelName, {
            type,
            data,
        });
    };
    this.url = function () {
        return "";
    };
    this.init = async function () {};
    this.config = async function () {
        return {
            code: 0,
            msg: "ok",
            data: {
                httpUrl: null,
                // 参数定义来自服务端 server/all，由 serverCloud store 放在 cloudConfig 里
                content: this.ServerInfo?.config?.cloudConfig?.content || "",
                functions: this.ServerInfo?.config?.cloudConfig?.functions || {},
            },
        };
    };
    this.start = async function () {
        this.send("starting", this.ServerInfo);
        this.send("success", this.ServerInfo);
    };
    this.ping = async function (): Promise<boolean> {
        return true;
    };
    this.stop = async function () {
        this.send("stopping", this.ServerInfo);
        this.send("stopped", this.ServerInfo);
    };
    this.cancel = async function () {
        cancelled = true;
    };

    const deps = (): CloudRunDeps => ({
        post: (url, data) => UserApi.post(url, data, { throwException: false }) as any,
        download: async (url) => {
            const ext = Files.ext(url.split("?")[0]) || "bin";
            const localPath = await me.ServerApi.file.temp(ext);
            await me.ServerApi.requestUrlFileToLocal(url, localPath);
            return localPath;
        },
        readImageAsDataUrl: async (file) => {
            const ext = path.extname(file).slice(1).toLowerCase();
            const mime = IMAGE_MIME[ext];
            if (!mime) {
                throw new Error(`云端模型暂不支持该图片格式：${ext || "未知"}`);
            }
            const stat = await fs.promises.stat(file);
            if (stat.size > MAX_IMAGE_BYTES) {
                throw new Error("参考图片不能超过 8MB");
            }
            const buf = await fs.promises.readFile(file);
            return `data:${mime};base64,${buf.toString("base64")}`;
        },
        readAudioAsDataUrl: async (file) => {
            const mp3 = await me.ServerApi.file.temp("mp3");
            try {
                await me.ServerApi.app.spawnBinary("ffmpeg", [
                    "-y",
                    "-i",
                    file,
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-b:a",
                    "32k",
                    mp3,
                ]);
                const stat = await fs.promises.stat(mp3);
                if (stat.size > MAX_AUDIO_BYTES) {
                    throw new Error("音频过长，云端语音识别单次最长约 40 分钟，请先分段");
                }
                const buf = await fs.promises.readFile(mp3);
                return {
                    dataUrl: `data:audio/mpeg;base64,${buf.toString("base64")}`,
                    // 32kbps 恒定码率：每秒约 4000 字节
                    duration: Math.round((buf.length / 4000) * 10) / 10,
                };
            } finally {
                fs.promises.rm(mp3, { force: true }).catch(() => {});
            }
        },
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        now: () => Date.now(),
        isCancelled: () => cancelled,
    });

    const call = async (fn: string, data: ServerFunctionDataType) => {
        cancelled = false;
        const start = Date.now();
        this.send("taskRunning", { id: data.id });
        try {
            const result = await runCloudFunction(
                deps(),
                { name: this.ServerInfo.name, version: this.ServerInfo.version },
                fn,
                {
                    id: data.id,
                    prompt: data.prompt,
                    param: data.param,
                    image: data.image,
                    text: data.text,
                    audio: data.audio,
                },
            );
            return {
                code: 0,
                msg: "ok",
                data: {
                    type: "success",
                    start,
                    end: Date.now(),
                    data: result,
                },
            };
        } catch (e: any) {
            Log.error("cloudServer.call.error", {
                fn,
                model: this.ServerInfo?.name,
                error: (e && e.message) || String(e),
            });
            throw e;
        }
    };

    for (const fn of ["textToImage", "imageToImage", "textToVideo", "imageToVideo", "soundTts", "asr"]) {
        this[fn] = (data: ServerFunctionDataType) => call(fn, data);
    }
};
