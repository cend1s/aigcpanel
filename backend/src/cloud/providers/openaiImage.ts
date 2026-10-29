import { normalizeBaseUrl } from "./baseUrl.js";
import type { FileStore } from "../files.js";
import type { CloudProvider, ModelRow, QueryResult, SubmitResult } from "../types.js";

// OpenAI 兼容的文生图：provider_config = { baseUrl, apiKey, model, size? }
// 同步返回；上游给 url 就直接用，给 base64 就落盘后返回本服务的下载地址。
export class OpenAiImageProvider implements CloudProvider {
    readonly name = "openai-image";

    constructor(
        private files?: FileStore,
        private fetchImpl: typeof fetch = fetch,
    ) {}

    async submit(model: ModelRow, param: any): Promise<SubmitResult> {
        const { baseUrl, apiKey, model: upstreamModel, size } = model.providerConfig;
        if (!baseUrl || !apiKey || !upstreamModel) {
            throw new Error("供应商配置不完整");
        }
        const prompt = String(param?.prompt ?? "").trim();
        if (!prompt) {
            throw new Error("缺少提示词");
        }
        const w = Number(param?.param?.width);
        const h = Number(param?.param?.height);
        const res = await this.fetchImpl(`${normalizeBaseUrl(baseUrl)}/images/generations`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: upstreamModel,
                prompt,
                n: 1,
                size: w > 0 && h > 0 ? `${w}x${h}` : (param?.param?.size ?? size ?? "1024x1024"),
            }),
        });
        if (!res.ok) {
            throw new Error(`上游返回 ${res.status}`);
        }
        const item = ((await res.json()) as any)?.data?.[0];
        let url: string | undefined = item?.url;
        if (!url && item?.b64_json) {
            if (!this.files) {
                throw new Error("上游返回 base64，但未配置文件存储");
            }
            url = this.files.save(Buffer.from(item.b64_json, "base64"), "png");
        }
        if (!url) {
            throw new Error("上游没有返回图片");
        }
        return { kind: "done", result: { url }, usage: { units: 1 } };
    }

    async query(_model: ModelRow, _upstreamId: string): Promise<QueryResult> {
        return { status: "failed", error: "同步供应商不支持查询" };
    }
}
