// 与客户端约定一致的返回格式：{ code, msg, data }，code=0 表示成功
export const ok = <T>(data: T) => ({ code: 0, msg: "ok", data });
export const fail = (msg: string, code = -1, data: unknown = {}) => ({
    code,
    msg,
    data,
});
