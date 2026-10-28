// 云端模型调用的核心流程（提交 → 轮询 → 下载结果）。
// 不依赖 Electron，所有副作用通过 deps 注入，便于在 Node 里直接做单元测试。

export type CloudApiResult = {
    code: number;
    msg: string;
    data: any;
};

export type CloudRunDeps = {
    /** 调用后端接口（不抛异常，返回 {code, msg, data}） */
    post: (url: string, data: Record<string, any>) => Promise<CloudApiResult>;
    /** 把结果地址下载到本地临时文件，返回本地路径 */
    download: (url: string) => Promise<string>;
    /** 读取本地图片并转成 data URL */
    readImageAsDataUrl: (path: string) => Promise<string>;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
    isCancelled: () => boolean;
};

export type CloudRunOption = {
    pollInterval?: number;
    timeout?: number;
};

export class CloudRunError extends Error {
    constructor(
        message: string,
        public type = "",
    ) {
        super(message);
    }
}

const isRemoteRef = (s: string) => /^(https?:|data:)/i.test(s);

/**
 * 运行一次云端函数（textToImage / imageToImage / textToVideo / imageToVideo ...）。
 * 以桌面端任务 id 作为 clientId：任务被重试或应用重启后重新提交，后端会返回同一个云端任务，
 * 不会重复扣费。
 */
export const runCloudFunction = async (
    deps: CloudRunDeps,
    target: { name: string; version: string },
    fn: string,
    data: { id: string; prompt?: string; param?: any; image?: string },
    option: CloudRunOption = {},
): Promise<{ url: string }> => {
    const pollInterval = option.pollInterval ?? 2000;
    const timeout = option.timeout ?? 30 * 60 * 1000;

    const param: Record<string, any> = { type: fn, prompt: data.prompt ?? "", param: data.param ?? {} };
    if (data.image) {
        // 云端模型访问不到本地文件：本地路径转成 data URL 随请求提交
        param.image = isRemoteRef(data.image) ? data.image : await deps.readImageAsDataUrl(data.image);
    }

    const call = async (url: string, body: Record<string, any>) => {
        const res = await deps.post(url, body);
        if (res.code === 1001) {
            throw new CloudRunError("请先登录后再使用云端模型", "LoginRequired");
        }
        if (res.code) {
            throw new CloudRunError(res.msg || "云端请求失败", res.data?.type || "");
        }
        return res.data;
    };

    let task = await call("cloud/task/submit", {
        model: target.name,
        version: target.version,
        param,
        clientId: data.id,
    });
    const startedAt = deps.now();
    while (task.status === "reserved" || task.status === "running") {
        if (deps.isCancelled()) {
            throw new CloudRunError("任务已取消", "Cancelled");
        }
        if (deps.now() - startedAt > timeout) {
            // 不在这里退款：后端的兜底扫描会在超时后结算并退回额度
            throw new CloudRunError("等待云端结果超时，额度会自动退回", "Timeout");
        }
        await deps.sleep(pollInterval);
        task = await call("cloud/task/status", { id: task.id });
    }
    if (task.status === "failed") {
        throw new CloudRunError(task.error || "云端任务失败，额度已退回", "Failed");
    }
    const url = task.result?.url;
    if (typeof url !== "string" || !url) {
        throw new CloudRunError("云端没有返回结果文件", "EmptyResult");
    }
    return { url: await deps.download(url) };
};
