import type { Db } from "./db.js";
import { now, tx } from "./tx.js";

export type Plan = {
    id: number;
    title: string;
    subtitle: string;
    priceCents: number;
    durationDays: number;
    quota: number;
    functions: Record<string, unknown>;
    enabled: boolean;
    sort: number;
};

const toPlan = (r: any): Plan => ({
    id: Number(r.id),
    title: r.title,
    subtitle: r.subtitle,
    priceCents: Number(r.price_cents),
    durationDays: Number(r.duration_days),
    quota: Number(r.quota),
    functions: JSON.parse(r.functions || "{}"),
    enabled: !!r.enabled,
    sort: Number(r.sort),
});

export const listPlans = (db: Db, includeDisabled = false): Plan[] =>
    (db
        .prepare(
            `SELECT * FROM plans ${includeDisabled ? "" : "WHERE enabled = 1"} ORDER BY sort, id`,
        )
        .all() as any[]).map(toPlan);

export const getPlan = (db: Db, id: number): Plan | null => {
    const r = db.prepare("SELECT * FROM plans WHERE id = ?").get(id);
    return r ? toPlan(r) : null;
};

export const savePlan = (db: Db, p: Partial<Plan> & { title: string }): number => {
    const vals = [
        p.title,
        p.subtitle ?? "",
        p.priceCents ?? 0,
        p.durationDays ?? 30,
        p.quota ?? 0,
        JSON.stringify(p.functions ?? {}),
        p.enabled === false ? 0 : 1,
        p.sort ?? 0,
    ];
    if (p.id) {
        db.prepare(
            `UPDATE plans SET title=?, subtitle=?, price_cents=?, duration_days=?, quota=?, functions=?, enabled=?, sort=? WHERE id=?`,
        ).run(...(vals as any[]), p.id);
        return p.id;
    }
    const r = db
        .prepare(
            `INSERT INTO plans (title, subtitle, price_cents, duration_days, quota, functions, enabled, sort)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...(vals as any[]));
    return Number(r.lastInsertRowid);
};

/** 开通订阅；同一订单只会开通一次（order_id 去重），回调重复到达也安全。 */
export const activatePlan = (
    db: Db,
    userId: number,
    planId: number,
    orderId = 0,
    source = "order",
): number =>
    tx(db, () => {
        const plan = getPlan(db, planId);
        if (!plan) {
            throw new Error("套餐不存在");
        }
        if (orderId) {
            const dup: any = db.prepare("SELECT id FROM subscriptions WHERE order_id = ?").get(orderId);
            if (dup) {
                return Number(dup.id);
            }
        }
        // 已有未过期订阅时顺延：新订阅从旧订阅结束时开始
        const last: any = db
            .prepare(
                `SELECT MAX(end_time) AS e FROM subscriptions WHERE user_id = ? AND status = 'active' AND end_time > ?`,
            )
            .get(userId, now());
        const start = last?.e ? Number(last.e) : now();
        const r = db
            .prepare(
                `INSERT INTO subscriptions (user_id, plan_id, quota_total, start_time, end_time, source, order_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(userId, planId, plan.quota, start, start + plan.durationDays * 86400, source, orderId);
        return Number(r.lastInsertRowid);
    });

/** 当前生效（已开始、未过期、未取消）的订阅，按结束时间先到期先用。 */
export const activeSubscriptions = (db: Db, userId: number) =>
    (db
        .prepare(
            `SELECT s.*, p.title AS plan_title, p.functions AS plan_functions FROM subscriptions s
             JOIN plans p ON p.id = s.plan_id
             WHERE s.user_id = ? AND s.status = 'active' AND s.start_time <= ? AND s.end_time > ?
             ORDER BY s.end_time`,
        )
        .all(userId, now(), now()) as any[]).map((s) => ({
        id: Number(s.id),
        planId: Number(s.plan_id),
        planTitle: s.plan_title as string,
        quotaTotal: Number(s.quota_total),
        quotaUsed: Number(s.quota_used),
        remaining: Number(s.quota_total) - Number(s.quota_used),
        endTime: Number(s.end_time),
        functions: JSON.parse(s.plan_functions || "{}") as Record<string, unknown>,
    }));

/** 用户当前可用的功能权限：所有生效套餐的并集，写入 user_info.data.functions。 */
export const functionsFor = (db: Db, userId: number): Record<string, unknown> =>
    Object.assign({}, ...activeSubscriptions(db, userId).map((s) => s.functions));
