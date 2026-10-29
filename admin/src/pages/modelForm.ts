// 云端模型：后端存的是 providerConfig / pricing / functions 三个 JSON 对象，
// 后台表单把它们拆成下拉、多选和输入框。这里负责两者之间的转换。

export const NAME_PREFIX = "Cloud";

export const PROVIDER_OPTIONS: Record<string, { label: string; functions: string[] }> = {
    "openai-chat": { label: "文本生成（OpenAI 兼容 /chat/completions）", functions: ["textGen"] },
    "openai-image": { label: "图片生成（OpenAI 兼容 /images/generations）", functions: ["textToImage"] },
    "openai-tts": { label: "语音合成（OpenAI 兼容 /audio/speech）", functions: ["soundTts"] },
    "openai-asr": { label: "语音识别（OpenAI 兼容 /audio/transcriptions）", functions: ["asr"] },
    mock: { label: "演示（不调用真实接口，用于试流程）", functions: [] },
};

export const FUNCTION_OPTIONS = [
    { value: "textGen", label: "电商文案" },
    { value: "textToImage", label: "文生图" },
    { value: "imageToImage", label: "图生图" },
    { value: "textToVideo", label: "文生视频" },
    { value: "imageToVideo", label: "图生视频" },
    { value: "soundTts", label: "语音合成" },
    { value: "asr", label: "语音识别" },
];

export const functionLabel = (fn: string) => FUNCTION_OPTIONS.find((o) => o.value === fn)?.label ?? fn;

type Vendor = {
    value: string;
    label: string;
    baseUrl: string;
    models: Partial<Record<string, string[]>>;
    voices?: (model: string) => string[];
};

const SF_VOICES = ["alex", "anna", "bella", "benjamin", "charles", "claire", "david", "diana"];
const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];

// 常用厂商：选中后自动填接口地址，并给出常见模型名（输入框仍可自由填写）
export const VENDORS: Vendor[] = [
    {
        value: "siliconflow",
        label: "硅基流动",
        baseUrl: "https://api.siliconflow.cn/v1",
        models: {
            "openai-chat": ["Qwen/Qwen3-8B", "Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3", "THUDM/GLM-4-9B-0414"],
            "openai-image": ["Kwai-Kolors/Kolors"],
            "openai-tts": ["FunAudioLLM/CosyVoice2-0.5B"],
            "openai-asr": ["FunAudioLLM/SenseVoiceSmall"],
        },
        voices: (model) => SF_VOICES.map((v) => `${model || "FunAudioLLM/CosyVoice2-0.5B"}:${v}`),
    },
    {
        value: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        models: {
            "openai-chat": ["gpt-4o-mini", "gpt-4o"],
            "openai-image": ["gpt-image-1", "dall-e-3"],
            "openai-tts": ["gpt-4o-mini-tts", "tts-1"],
            "openai-asr": ["whisper-1"],
        },
        voices: () => OPENAI_VOICES,
    },
    {
        value: "dashscope",
        label: "阿里云百炼",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        models: { "openai-chat": ["qwen-plus", "qwen-turbo", "qwen-max"] },
    },
    { value: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", models: { "openai-chat": ["deepseek-chat"] } },
    { value: "volcengine", label: "火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: {} },
    { value: "zhipu", label: "智谱", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: { "openai-chat": ["glm-4-flash", "glm-4-plus"] } },
    { value: "moonshot", label: "Kimi（月之暗面）", baseUrl: "https://api.moonshot.cn/v1", models: { "openai-chat": ["moonshot-v1-8k"] } },
];

export const vendorOfBaseUrl = (baseUrl?: string) => {
    const u = String(baseUrl ?? "").replace(/\/+$/, "");
    return VENDORS.find((v) => u === v.baseUrl || u.startsWith(`${v.baseUrl}/`))?.value ?? "custom";
};

export const IMAGE_SIZES = ["1024x1024", "768x1024", "1024x768", "720x1280", "1280x720", "960x1280", "720x1440"];

export const ASR_LANGUAGES = [
    { value: "", label: "自动识别" },
    { value: "zh", label: "中文" },
    { value: "en", label: "英文" },
    { value: "yue", label: "粤语" },
    { value: "ja", label: "日语" },
    { value: "ko", label: "韩语" },
];

export const PRICING_UNITS = [
    { value: "char", label: "按字" },
    { value: "second", label: "按秒" },
    { value: "minute", label: "按分钟" },
    { value: "image", label: "按张" },
];

/** 表单里能直接编辑的 providerConfig 字段；其余字段原样保留 */
const KNOWN_CONFIG = ["baseUrl", "apiKey", "model", "extraBody", "size", "dialect", "voice", "format", "language", "responseFormat"];

export type ExtraParam = { key: string; value: string };

export type ModelFormValues = {
    nameSuffix: string;
    version: string;
    title: string;
    description?: string;
    enabled: boolean;
    provider: string;
    vendor: string;
    baseUrl?: string;
    apiKey?: string;
    upstreamModel?: string;
    disableThinking?: boolean;
    imageSize?: string;
    dialect?: string;
    voice?: string;
    audioFormat?: string;
    voices?: string[];
    language?: string;
    responseFormat?: string;
    extraParams?: ExtraParam[];
    pricingType: "per_call" | "per_token" | "per_unit";
    amount?: number;
    unit?: string;
    inputPer1k?: number;
    outputPer1k?: number;
    functionList: string[];
    // 编辑时原样带回、表单不展示的数据
    _otherConfig?: Record<string, unknown>;
    _functionsRaw?: Record<string, any>;
};

const parseValue = (s: string): unknown => {
    const t = s.trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
    if (/^[[{]/.test(t)) {
        try {
            return JSON.parse(t);
        } catch {
            return t;
        }
    }
    return t;
};

const showValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** 后端记录 → 表单初始值 */
export const modelToForm = (r: any): ModelFormValues => {
    const cfg: Record<string, any> = r?.providerConfig ?? {};
    const extra: Record<string, unknown> = { ...(cfg.extraBody ?? {}) };
    const disableThinking = extra.enable_thinking === false;
    delete extra.enable_thinking;
    const pricing = r?.pricing ?? {};
    const functions: Record<string, any> = r?.functions ?? {};
    const speaker = (functions.soundTts?.param ?? []).find((p: any) => p?.name === "speaker");
    return {
        nameSuffix: String(r?.name ?? "").replace(new RegExp(`^${NAME_PREFIX}`), ""),
        version: r?.version ?? "1.0",
        title: r?.title ?? "",
        description: r?.description ?? "",
        enabled: r?.enabled ?? true,
        provider: r?.provider ?? "",
        vendor: vendorOfBaseUrl(cfg.baseUrl),
        baseUrl: cfg.baseUrl ?? "",
        apiKey: cfg.apiKey ?? "",
        upstreamModel: cfg.model ?? "",
        disableThinking,
        imageSize: cfg.size ?? undefined,
        dialect: cfg.dialect ?? "",
        voice: cfg.voice ?? "",
        audioFormat: cfg.format ?? "mp3",
        voices: (speaker?.options ?? []).map((o: any) => String(o.value)),
        language: cfg.language ?? "",
        responseFormat: cfg.responseFormat ?? "verbose_json",
        extraParams: Object.entries(extra).map(([key, v]) => ({ key, value: showValue(v) })),
        pricingType: pricing.type ?? "per_call",
        amount: pricing.amount,
        unit: pricing.unit ?? "char",
        inputPer1k: pricing.inputPer1k,
        outputPer1k: pricing.outputPer1k,
        functionList: Object.keys(functions),
        _otherConfig: Object.fromEntries(Object.entries(cfg).filter(([k]) => !KNOWN_CONFIG.includes(k))),
        _functionsRaw: functions,
    };
};

const voiceLabel = (v: string) => v.split(":").pop() || v;

/** 表单 → 保存到后端的数据 */
export const formToModel = (v: ModelFormValues) => {
    const provider = v.provider;
    const config: Record<string, unknown> = { ...(v._otherConfig ?? {}) };
    if (provider !== "mock") {
        config.baseUrl = (v.baseUrl ?? "").trim();
        config.apiKey = v.apiKey ?? "";
        config.model = (v.upstreamModel ?? "").trim();
    }
    const extraBody: Record<string, unknown> = {};
    for (const p of v.extraParams ?? []) {
        if (p?.key?.trim()) extraBody[p.key.trim()] = parseValue(String(p.value ?? ""));
    }
    if (provider === "openai-chat" && v.disableThinking) extraBody.enable_thinking = false;
    if (Object.keys(extraBody).length) config.extraBody = extraBody;
    if (provider === "openai-image") {
        if (v.imageSize) config.size = v.imageSize;
        if (v.dialect) config.dialect = v.dialect;
    }
    if (provider === "openai-tts") {
        if (v.voice) config.voice = v.voice;
        if (v.audioFormat) config.format = v.audioFormat;
    }
    if (provider === "openai-asr") {
        if (v.language) config.language = v.language;
        if (v.responseFormat === "json") config.responseFormat = "json";
    }

    const pricing =
        v.pricingType === "per_token"
            ? { type: "per_token", inputPer1k: Number(v.inputPer1k ?? 0), outputPer1k: Number(v.outputPer1k ?? 0) }
            : v.pricingType === "per_unit"
              ? { type: "per_unit", unit: v.unit ?? "char", amount: Number(v.amount ?? 0) }
              : { type: "per_call", amount: Number(v.amount ?? 0) };

    // 功能：保留原有的参数定义；语音合成的音色列表生成下拉参数
    const raw = v._functionsRaw ?? {};
    const functions: Record<string, { param: any[] }> = {};
    for (const fn of v.functionList ?? []) {
        let param: any[] = Array.isArray(raw[fn]?.param) ? raw[fn].param : [];
        if (fn === "soundTts") {
            param = param.filter((p) => p?.name !== "speaker");
            const voices = (v.voices ?? []).filter(Boolean);
            if (voices.length) {
                param = [
                    {
                        name: "speaker",
                        type: "select",
                        title: "音色",
                        defaultValue: v.voice && voices.includes(v.voice) ? v.voice : voices[0],
                        options: voices.map((x) => ({ label: voiceLabel(x), value: x })),
                    },
                    ...param,
                ];
            }
        }
        functions[fn] = { param };
    }

    return {
        name: `${NAME_PREFIX}${(v.nameSuffix ?? "").trim()}`,
        version: (v.version ?? "").trim(),
        title: (v.title ?? "").trim(),
        description: v.description ?? "",
        enabled: v.enabled !== false,
        provider,
        providerConfig: config,
        pricing,
        functions,
    };
};

/** 列表里的计价说明 */
export const pricingText = (p: any) => {
    if (!p?.type) return "-";
    if (p.type === "per_call") return `${p.amount} 额度/次`;
    if (p.type === "per_token") return `输入 ${p.inputPer1k} / 输出 ${p.outputPer1k} 额度每千 token`;
    const unit = PRICING_UNITS.find((u) => u.value === p.unit)?.label.replace("按", "") ?? p.unit;
    return `${p.amount} 额度/${unit}`;
};
