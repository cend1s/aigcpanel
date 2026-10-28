import { t } from "../lang";
import { Dialog } from "../lib/dialog";
import { useServerCloudStore } from "../store/modules/serverCloud";

export type CloudTask = {
    id: string;
    status: "reserved" | "running" | "succeeded" | "failed";
    result: any;
    error: string;
    cost: number;
};

export class CloudError extends Error {
    constructor(
        message: string,
        public type = "",
    ) {
        super(message);
    }
}

const POLL_INTERVAL = 2000;
const POLL_TIMEOUT = 10 * 60 * 1000;

const call = async (url: string, data: Record<string, any>) => {
    const res = await window.$mapi.user.apiPost(url, data, {
        throwException: false,
    });
    if (res.code === 1001) {
        // 登录失效：打开用户窗口让用户重新登录
        window.$mapi.user.open().then();
        throw new CloudError(t("cloud.loginRequired"), "LoginRequired");
    }
    if (res.code) {
        throw new CloudError(res.msg, res.data?.type || "");
    }
    return res.data;
};

export const CloudService = {
    /** 云端模型清单里支持某个功能（如 textGen）的模型 */
    async listModels(fn: string) {
        const store = useServerCloudStore();
        await store.waitReady();
        return store.records.filter((r) => Object.keys(r.functions).includes(fn));
    },

    /**
     * 提交云端任务并等待完成。
     * 额度不足时（CreditNotEnough）提示并引导到充值页；其他错误抛出 CloudError。
     */
    async run(
        model: { name: string; version: string },
        param: Record<string, any>,
        option: { signal?: AbortSignal; onUpdate?: (task: CloudTask) => void } = {},
    ): Promise<CloudTask> {
        let task: CloudTask;
        try {
            task = await call("cloud/task/submit", {
                model: model.name,
                version: model.version,
                param,
            });
        } catch (e) {
            if (e instanceof CloudError && e.type === "CreditNotEnough") {
                Dialog.tipError(e.message);
                setTimeout(() => window.$mapi.user.open().then(), 1500);
            }
            throw e;
        }
        const startedAt = Date.now();
        while (task.status === "reserved" || task.status === "running") {
            option.onUpdate?.(task);
            if (option.signal?.aborted) {
                throw new CloudError(t("cloud.cancelled"), "Cancelled");
            }
            if (Date.now() - startedAt > POLL_TIMEOUT) {
                throw new CloudError(t("cloud.timeout"), "Timeout");
            }
            await new Promise((r) => setTimeout(r, POLL_INTERVAL));
            task = await call("cloud/task/status", { id: task.id });
        }
        if (task.status === "failed") {
            throw new CloudError(task.error || t("cloud.failed"), "Failed");
        }
        option.onUpdate?.(task);
        return task;
    },
};
