// 管理后台访问后端的唯一出口：带上管理员 token，统一处理 {code, msg, data} 与 HTTP 错误
const TOKEN_KEY = "aigc_admin_token";

export const tokenStore = {
    get: () => localStorage.getItem(TOKEN_KEY) ?? "",
    set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
    clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
    constructor(
        message: string,
        public statusCode: number,
    ) {
        super(message);
    }
}

export const api = async <T = any>(path: string, body: unknown = {}): Promise<T> => {
    const res = await fetch(`/api/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Api-Token": tokenStore.get() },
        body: JSON.stringify(body),
    });
    let json: any = null;
    try {
        json = await res.json();
    } catch {
        // 非 JSON 响应按 HTTP 错误处理
    }
    if (res.status === 403) throw new ApiError(json?.msg || "无权限", 403);
    if (!res.ok || !json) throw new ApiError(json?.msg || `请求失败（${res.status}）`, res.status);
    if (json.code === 1001) throw new ApiError(json.msg || "请先登录", 401);
    if (json.code) throw new ApiError(json.msg || "操作失败", 400);
    return json.data as T;
};
