import type { FileStore } from "../files.js";
import type { CloudProvider, ModelRow, QueryResult, SubmitResult } from "../types.js";

// 开发与测试用的供应商：param.async 为真时走异步轮询，param.fail 为真时模拟上游失败。
export class MockProvider implements CloudProvider {
    readonly name = "mock";
    private jobs = new Map<string, QueryResult>();
    private seq = 0;

    constructor(private files?: FileStore) {}

    async submit(_model: ModelRow, param: any): Promise<SubmitResult> {
        if (param?.fail) {
            throw new Error("mock upstream error");
        }
        if (param?.async) {
            const id = `mock-${++this.seq}`;
            this.jobs.set(id, { status: "running" });
            return { kind: "async", upstreamId: id };
        }
        // 语音合成 / 识别的演示结果：1 秒静音 wav、一条固定识别文本
        if (param?.type === "soundTts" && this.files) {
            return { kind: "done", result: { url: this.files.save(silentWav(1), "wav") }, usage: { units: String(param?.text ?? "").length } };
        }
        if (param?.type === "asr") {
            return { kind: "done", result: { records: [{ start: 0, end: 1000, text: "（演示）云端语音识别结果" }] }, usage: { units: 1 } };
        }
        const last = Array.isArray(param?.messages) ? param.messages[param.messages.length - 1]?.content : "";
        return {
            kind: "done",
            result: { text: `echo:${param?.prompt ?? last ?? ""}` },
            usage: param?.usage,
        };
    }

    async query(_model: ModelRow, upstreamId: string): Promise<QueryResult> {
        return this.jobs.get(upstreamId) ?? { status: "failed", error: "job not found" };
    }

    // 测试控制
    finish(upstreamId: string, result: unknown = {}, usage?: any) {
        this.jobs.set(upstreamId, { status: "succeeded", result, usage });
    }
    failJob(upstreamId: string, error = "upstream failed") {
        this.jobs.set(upstreamId, { status: "failed", error });
    }
}

/** 生成指定秒数的 16kHz 单声道 16bit 静音 wav。 */
export const silentWav = (seconds: number) => {
    const rate = 16000;
    const data = rate * 2 * seconds;
    const buf = Buffer.alloc(44 + data);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + data, 4);
    buf.write("WAVEfmt ", 8);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(data, 40);
    return buf;
};
