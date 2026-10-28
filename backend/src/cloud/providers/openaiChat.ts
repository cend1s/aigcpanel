import type { CloudProvider, ModelRow, QueryResult, SubmitResult } from "../types.js";

// OpenAI 兼容的文本模型：provider_config = { baseUrl, apiKey, model }
// 目前为非流式调用；流式输出（文案写作的逐字展示）后续单独加接口。
export class OpenAiChatProvider implements CloudProvider {
    readonly name = "openai-chat";

    constructor(private fetchImpl: typeof fetch = fetch) {}

    async submit(model: ModelRow, param: any): Promise<SubmitResult> {
        const { baseUrl, apiKey, model: upstreamModel } = model.providerConfig;
        if (!baseUrl || !apiKey || !upstreamModel) {
            throw new Error("供应商配置不完整");
        }
        const res = await this.fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: upstreamModel,
                messages: param?.messages ?? [{ role: "user", content: String(param?.prompt ?? "") }],
                max_tokens: param?.max_tokens ?? param?.maxTokens ?? 1024,
                temperature: param?.temperature,
            }),
        });
        if (!res.ok) {
            throw new Error(`上游返回 ${res.status}`);
        }
        const json: any = await res.json();
        return {
            kind: "done",
            result: { text: json.choices?.[0]?.message?.content ?? "" },
            usage: {
                inputTokens: json.usage?.prompt_tokens,
                outputTokens: json.usage?.completion_tokens,
            },
        };
    }

    async query(_model: ModelRow, _upstreamId: string): Promise<QueryResult> {
        return { status: "failed", error: "同步供应商不支持查询" };
    }
}
