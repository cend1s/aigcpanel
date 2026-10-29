// 后台常把完整接口地址填进 baseUrl（如 .../v1/chat/completions），这里统一去掉接口路径和结尾斜杠，
// 各供应商再拼上自己的接口路径。
const ENDPOINT_RE = /\/(chat\/completions|images\/generations|audio\/(speech|transcriptions))\/?$/;

export const normalizeBaseUrl = (baseUrl: unknown) => String(baseUrl).trim().replace(/\/+$/, "").replace(ENDPOINT_RE, "");
