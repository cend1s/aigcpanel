// 单价规则存在 cloud_models.pricing（JSON），可由管理后台配置：
//   { "type": "per_call", "amount": 20 }
//   { "type": "per_token", "inputPer1k": 1, "outputPer1k": 3 }
//   { "type": "per_unit", "unit": "second", "amount": 5 }   （按秒/张等，数量取自 usage.units）
//   unit 为 "char"（按字，语音合成）或 "minute"（按分钟，语音识别）时预估数量会自动换算
export type Pricing =
    | { type: "per_call"; amount: number }
    | { type: "per_token"; inputPer1k: number; outputPer1k: number }
    | { type: "per_unit"; unit: string; amount: number };

export type Usage = { inputTokens?: number; outputTokens?: number; units?: number };

const up = (n: number) => Math.max(0, Math.ceil(n));

/** 提交前的预估（用于预扣）：宁可多冻结，结算时多退少补。 */
export const estimateCost = (p: Pricing, param: any): number => {
    switch (p.type) {
        case "per_call":
            return up(p.amount);
        case "per_token": {
            const text = JSON.stringify(param?.messages ?? param?.prompt ?? "");
            const input = Math.ceil(text.length / 2);
            const output = Number(param?.max_tokens ?? param?.maxTokens ?? 1024);
            return up((input / 1000) * p.inputPer1k + (output / 1000) * p.outputPer1k);
        }
        case "per_unit": {
            // 数量：客户端声明的 units > 按字计价时取文本长度 > 音视频时长（秒，按分钟计价时换算） > 1
            let units = Number(param?.units);
            if (!(units > 0)) {
                const duration = Number(param?.duration);
                if (p.unit === "char") units = String(param?.text ?? param?.prompt ?? "").length;
                else if (duration > 0) units = p.unit === "minute" ? Math.ceil(duration / 60) : duration;
            }
            return up(p.amount * Math.max(units || 0, 1));
        }
        default:
            throw new Error("未知的计价类型");
    }
};

/** 结算：按供应商返回的实际用量计算；供应商没给用量时按预估。 */
export const actualCost = (p: Pricing, usage: Usage | undefined, estimate: number): number => {
    if (!usage) return estimate;
    switch (p.type) {
        case "per_call":
            return up(p.amount);
        case "per_token":
            return up(
                ((usage.inputTokens ?? 0) / 1000) * p.inputPer1k +
                    ((usage.outputTokens ?? 0) / 1000) * p.outputPer1k,
            );
        case "per_unit":
            return up(p.amount * (usage.units ?? 1));
    }
};

/** 校验后台配置的价格规则，避免配成负数或缺字段。 */
export const parsePricing = (raw: unknown): Pricing => {
    const p = raw as any;
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
    if (p?.type === "per_call" && num(p.amount)) return p;
    if (p?.type === "per_token" && num(p.inputPer1k) && num(p.outputPer1k)) return p;
    if (p?.type === "per_unit" && num(p.amount) && typeof p.unit === "string") return p;
    throw new Error("价格规则无效");
};
