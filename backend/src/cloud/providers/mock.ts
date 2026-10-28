import type { CloudProvider, ModelRow, QueryResult, SubmitResult } from "../types.js";

// 开发与测试用的供应商：param.async 为真时走异步轮询，param.fail 为真时模拟上游失败。
export class MockProvider implements CloudProvider {
    readonly name = "mock";
    private jobs = new Map<string, QueryResult>();
    private seq = 0;

    async submit(_model: ModelRow, param: any): Promise<SubmitResult> {
        if (param?.fail) {
            throw new Error("mock upstream error");
        }
        if (param?.async) {
            const id = `mock-${++this.seq}`;
            this.jobs.set(id, { status: "running" });
            return { kind: "async", upstreamId: id };
        }
        return {
            kind: "done",
            result: { text: `echo:${param?.prompt ?? ""}` },
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
