import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import {
    availableQuota,
    chargeExtra,
    fundingTotal,
    releaseFunds,
    reserveFunds,
    type Funding,
} from "../funding.js";
import { now, tx } from "../tx.js";
import { InsufficientQuota } from "../wallet.js";
import { getModel, getModelById } from "./models.js";
import { actualCost, estimateCost, parsePricing, type Usage } from "./pricing.js";
import type { ModelRow, ProviderRegistry } from "./types.js";

export class TaskError extends Error {
    constructor(
        message: string,
        public type = "",
    ) {
        super(message);
    }
}

type TaskRow = {
    id: string;
    userId: number;
    modelId: number;
    status: "reserved" | "running" | "succeeded" | "failed";
    reserved: number;
    settled: number;
    funding: Funding;
    upstreamId: string;
    result: unknown;
    error: string;
    createdAt: number;
    updatedAt: number;
};

const toTask = (r: any): TaskRow => ({
    id: r.id,
    userId: Number(r.user_id),
    modelId: Number(r.model_id),
    status: r.status,
    reserved: Number(r.reserved),
    settled: Number(r.settled),
    funding: JSON.parse(r.funding || "{}"),
    upstreamId: r.upstream_id,
    result: JSON.parse(r.result || "{}"),
    error: r.error,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
});

const loadTask = (db: Db, id: string): TaskRow | null => {
    const r = db.prepare("SELECT * FROM cloud_tasks WHERE id = ?").get(id);
    return r ? toTask(r) : null;
};

/** 对应客户端的 aigcpanel/task/check：提交前校验额度是否够用。 */
export const checkTask = (db: Db, userId: number, name: string, version: string) => {
    const model = getModel(db, name, version);
    if (!model) {
        throw new TaskError("云端模型不存在或已下架", "ModelNotFound");
    }
    const need = estimateCost(parsePricing(model.pricing), {});
    if (availableQuota(db, userId) < Math.max(need, 1)) {
        throw new TaskError("额度不足，请先充值", "CreditNotEnough");
    }
};

/** 成功结算：多退少补，状态只允许从 reserved/running 变为 succeeded（CAS，重复调用无副作用）。 */
const finalizeSuccess = (db: Db, task: TaskRow, model: ModelRow, result: unknown, usage?: Usage) =>
    tx(db, () => {
        const cost = actualCost(parsePricing(model.pricing), usage, task.reserved);
        const cas = db
            .prepare(
                `UPDATE cloud_tasks SET status = 'succeeded', result = ?, updated_at = ?
                 WHERE id = ? AND status IN ('reserved','running')`,
            )
            .run(JSON.stringify(result ?? {}), now(), task.id);
        if (cas.changes !== 1) return false;
        const ref = { type: "cloud_task", id: task.id };
        let funding = task.funding;
        let settled = cost;
        if (cost < fundingTotal(funding)) {
            funding = releaseFunds(db, task.userId, funding, fundingTotal(funding) - cost, ref, "task_refund");
        } else if (cost > fundingTotal(funding)) {
            settled = fundingTotal(funding) + chargeExtra(db, task.userId, cost - fundingTotal(funding), ref);
        }
        db.prepare("UPDATE cloud_tasks SET settled = ?, funding = ? WHERE id = ?").run(
            settled,
            JSON.stringify(funding),
            task.id,
        );
        return true;
    });

/** 失败退款：全额退回预扣。 */
const finalizeFailure = (db: Db, task: TaskRow, error: string) =>
    tx(db, () => {
        const cas = db
            .prepare(
                `UPDATE cloud_tasks SET status = 'failed', error = ?, updated_at = ?
                 WHERE id = ? AND status IN ('reserved','running')`,
            )
            .run(error.slice(0, 500), now(), task.id);
        if (cas.changes !== 1) return false;
        const rest = releaseFunds(
            db,
            task.userId,
            task.funding,
            fundingTotal(task.funding),
            { type: "cloud_task", id: task.id },
            "task_refund",
        );
        db.prepare("UPDATE cloud_tasks SET settled = 0, funding = ? WHERE id = ?").run(
            JSON.stringify(rest),
            task.id,
        );
        return true;
    });

export const submitTask = async (
    db: Db,
    registry: ProviderRegistry,
    userId: number,
    input: { model: string; version: string; param?: any; clientId?: string },
) => {
    const clientId = String(input.clientId ?? "").slice(0, 100);
    if (clientId) {
        // 同一客户端任务只会创建一次：再次提交直接返回已有任务（桌面端重试、重启后续跑）
        const existing: any = db
            .prepare("SELECT id FROM cloud_tasks WHERE user_id = ? AND client_id = ?")
            .get(userId, clientId);
        if (existing) {
            return refreshTask(db, registry, existing.id, userId);
        }
    }
    const model = getModel(db, input.model, input.version);
    if (!model) {
        throw new TaskError("云端模型不存在或已下架", "ModelNotFound");
    }
    const provider = registry.get(model.provider);
    if (!provider) {
        throw new TaskError("模型供应商未启用", "ProviderUnavailable");
    }
    const param = input.param ?? {};
    const estimate = estimateCost(parsePricing(model.pricing), param);
    const id = randomUUID();

    // 先预扣再调用上游：额度不足直接拒绝；任务行与预扣在同一事务里落库
    try {
        tx(db, () => {
            const funding = estimate > 0 ? reserveFunds(db, userId, estimate, { type: "cloud_task", id }) : { wallet: 0, subs: [] };
            db.prepare(
                `INSERT INTO cloud_tasks (id, user_id, model_id, status, reserved, funding, param, client_id, created_at, updated_at)
                 VALUES (?, ?, ?, 'reserved', ?, ?, ?, ?, ?, ?)`,
            ).run(id, userId, model.id, estimate, JSON.stringify(funding), JSON.stringify(param), clientId, now(), now());
        });
    } catch (e) {
        if (e instanceof InsufficientQuota) {
            throw new TaskError("额度不足，请先充值", "CreditNotEnough");
        }
        throw e;
    }

    const task = loadTask(db, id)!;
    try {
        const res = await provider.submit(model, param);
        if (res.kind === "done") {
            finalizeSuccess(db, task, model, res.result, res.usage);
        } else {
            db.prepare("UPDATE cloud_tasks SET status = 'running', upstream_id = ?, updated_at = ? WHERE id = ? AND status = 'reserved'").run(
                res.upstreamId,
                now(),
                id,
            );
        }
    } catch (e: any) {
        finalizeFailure(db, task, String(e?.message ?? e));
    }
    return taskView(db, id)!;
};

export const taskView = (db: Db, id: string) => {
    const t = loadTask(db, id);
    return t
        ? { id: t.id, status: t.status, result: t.result, error: t.error, cost: t.settled }
        : null;
};

/** 查询并推进任务：运行中的任务向上游查询，到达终态时结算或退款。 */
export const refreshTask = async (
    db: Db,
    registry: ProviderRegistry,
    id: string,
    userId?: number,
) => {
    const task = loadTask(db, id);
    if (!task || (userId !== undefined && task.userId !== userId)) {
        throw new TaskError("任务不存在", "TaskNotFound");
    }
    if (task.status === "running") {
        const model = getModelById(db, task.modelId)!;
        const provider = registry.get(model.provider);
        if (provider) {
            const q = await provider.query(model, task.upstreamId);
            if (q.status === "succeeded") finalizeSuccess(db, task, model, q.result, q.usage);
            else if (q.status === "failed") finalizeFailure(db, task, q.error);
        }
    }
    return taskView(db, id)!;
};

/**
 * 兜底扫描：进程崩溃或上游长时间无响应时，保证不留下悬挂的冻结额度。
 * - reserved 超过 staleSeconds：说明提交上游前后进程崩溃，没有上游任务，直接退款
 * - running：先向上游查询；超过 maxAgeSeconds 仍未结束则判为超时并退款
 */
export const sweepTasks = async (
    db: Db,
    registry: ProviderRegistry,
    opts = { staleSeconds: 120, maxAgeSeconds: 3600 },
) => {
    const stale: any[] = db
        .prepare("SELECT id FROM cloud_tasks WHERE status IN ('reserved','running') AND updated_at < ?")
        .all(now() - opts.staleSeconds);
    let settled = 0;
    for (const { id } of stale) {
        const task = loadTask(db, id)!;
        if (task.status === "reserved") {
            if (finalizeFailure(db, task, "任务提交中断")) settled++;
            continue;
        }
        const view = await refreshTask(db, registry, id).catch(() => null);
        if (view && view.status !== "running") {
            settled++;
            continue;
        }
        if (now() - task.createdAt > opts.maxAgeSeconds && finalizeFailure(db, loadTask(db, id)!, "任务超时")) {
            settled++;
        }
    }
    return settled;
};
