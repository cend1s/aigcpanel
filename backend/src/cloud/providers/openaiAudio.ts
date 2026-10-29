import { normalizeBaseUrl } from "./baseUrl.js";
import type { FileStore } from "../files.js";
import type { CloudProvider, ModelRow, QueryResult, SubmitResult } from "../types.js";


const AUDIO_EXT: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/flac": "flac",
    "video/mp4": "mp4",
};

/** 客户端把本地音频转成 data URL 随任务提交；这里还原成二进制。 */
export const decodeAudioDataUrl = (s: unknown): { buf: Buffer; mime: string; ext: string } => {
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(s ?? ""));
    if (!m) {
        throw new Error("缺少音频文件");
    }
    const mime = m[1].toLowerCase();
    const ext = AUDIO_EXT[mime];
    if (!ext) {
        throw new Error(`不支持的音频格式：${mime}`);
    }
    return { buf: Buffer.from(m[2], "base64"), mime, ext };
};

/** 计价单位为 minute 时按分钟向上取整，其余按秒。 */
const durationUnits = (model: ModelRow, seconds: number) =>
    model.pricing?.unit === "minute" ? Math.ceil(seconds / 60) : Math.ceil(seconds);

// OpenAI 兼容的语音识别：provider_config = { baseUrl, apiKey, model, language?, responseFormat? }
// 默认请求 verbose_json 拿分段时间轴；上游不支持分段时把 responseFormat 配成 "json"，整段文字作为一条记录。
// 返回 { records: [{ start, end, text }] }，时间单位毫秒，与本地语音识别模型一致。
export class OpenAiAsrProvider implements CloudProvider {
    readonly name = "openai-asr";

    constructor(private fetchImpl: typeof fetch = fetch) {}

    async submit(model: ModelRow, param: any): Promise<SubmitResult> {
        const { baseUrl, apiKey, model: upstreamModel, language, responseFormat } = model.providerConfig;
        if (!baseUrl || !apiKey || !upstreamModel) {
            throw new Error("供应商配置不完整");
        }
        const audio = decodeAudioDataUrl(param?.audio);
        const format = responseFormat === "json" ? "json" : "verbose_json";
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(audio.buf)], { type: audio.mime }), `audio.${audio.ext}`);
        form.append("model", String(upstreamModel));
        form.append("response_format", format);
        const lang = param?.param?.language || language;
        if (lang) {
            form.append("language", String(lang));
        }
        const res = await this.fetchImpl(`${normalizeBaseUrl(baseUrl)}/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
        });
        if (!res.ok) {
            throw new Error(`上游返回 ${res.status}`);
        }
        const json: any = await res.json();
        const segments: any[] = Array.isArray(json?.segments) ? json.segments : [];
        let duration = Number(json?.duration) || 0;
        let records = segments
            .map((s) => ({
                start: Math.round(Number(s.start) * 1000),
                end: Math.round(Number(s.end) * 1000),
                text: String(s.text ?? "").trim(),
            }))
            .filter((r) => r.text);
        if (!records.length) {
            const text = String(json?.text ?? "").trim();
            if (!text) {
                throw new Error("上游没有返回识别结果");
            }
            records = [{ start: 0, end: Math.round(duration * 1000), text }];
        }
        if (!duration) {
            duration = records[records.length - 1].end / 1000;
        }
        // 上游没给时长时按客户端声明的时长计费，都没有则按 1 个单位
        const seconds = duration || Number(param?.duration) || 0;
        return {
            kind: "done",
            result: { records },
            usage: { units: seconds > 0 ? Math.max(1, durationUnits(model, seconds)) : 1 },
        };
    }

    async query(_model: ModelRow, _upstreamId: string): Promise<QueryResult> {
        return { status: "failed", error: "同步供应商不支持查询" };
    }
}

// OpenAI 兼容的语音合成：provider_config = { baseUrl, apiKey, model, voice?, format? }
// 音色取客户端参数 speaker / voice，其次取配置里的 voice；音频落盘后返回本服务的下载地址。
// 用量按字数（usage.units = 字符数），计价可配 per_call 或 { "type": "per_unit", "unit": "char" }。
export class OpenAiTtsProvider implements CloudProvider {
    readonly name = "openai-tts";

    constructor(
        private files?: FileStore,
        private fetchImpl: typeof fetch = fetch,
    ) {}

    async submit(model: ModelRow, param: any): Promise<SubmitResult> {
        const { baseUrl, apiKey, model: upstreamModel, voice, format } = model.providerConfig;
        if (!baseUrl || !apiKey || !upstreamModel) {
            throw new Error("供应商配置不完整");
        }
        if (!this.files) {
            throw new Error("未配置文件存储");
        }
        const text = String(param?.text ?? param?.prompt ?? "").trim();
        if (!text) {
            throw new Error("缺少要合成的文本");
        }
        const p = param?.param ?? {};
        const ext = format === "wav" ? "wav" : "mp3";
        const speed = Number(p.speed);
        const res = await this.fetchImpl(`${normalizeBaseUrl(baseUrl)}/audio/speech`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: upstreamModel,
                input: text,
                voice: p.speaker || p.voice || voice || "alloy",
                response_format: ext,
                ...(speed > 0 ? { speed } : {}),
            }),
        });
        if (!res.ok) {
            throw new Error(`上游返回 ${res.status}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) {
            throw new Error("上游没有返回音频");
        }
        return { kind: "done", result: { url: this.files.save(buf, ext) }, usage: { units: text.length } };
    }

    async query(_model: ModelRow, _upstreamId: string): Promise<QueryResult> {
        return { status: "failed", error: "同步供应商不支持查询" };
    }
}
