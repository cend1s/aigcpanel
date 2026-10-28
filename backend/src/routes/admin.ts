import type { FastifyInstance } from "fastify";
import { saveModel } from "../cloud/models.js";
import type { AppContext } from "../context.js";
import { completeOrder, listOrders, OrderError } from "../pay/orders.js";
import { listPlans, savePlan } from "../plans.js";
import { createRedemptions, listRedemptions, RedeemError } from "../redeem.js";
import { fail, ok } from "../response.js";
import { isFailure, requireUser } from "../session.js";
import { now, tx } from "../tx.js";
import { ROLE_ADMIN } from "../users.js";
import { credit, debit, InsufficientQuota, WalletError } from "../wallet.js";

export const adminRoutes = (app: FastifyInstance, { db }: AppContext) => {
    // 管理接口统一鉴权：非管理员一律 403，不暴露接口是否存在的细节
    app.addHook("preHandler", async (req, reply) => {
        if (!req.url.startsWith("/api/admin/")) return;
        const user = requireUser(db, req);
        if (isFailure(user) || user.role < ROLE_ADMIN) {
            return reply.code(403).send({ code: 403, msg: "无权限", data: {} });
        }
        (req as any).admin = user;
    });

    const audit = (req: any, action: string, target: string, detail: unknown) =>
        db
            .prepare("INSERT INTO audit_logs (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(req.admin.id, action, target, JSON.stringify(detail), now());

    app.post("/api/admin/user/list", async (req) => {
        const b = (req.body ?? {}) as { keyword?: string; page?: number; pageSize?: number };
        const size = Math.min(Math.max(Number(b.pageSize) || 20, 1), 100);
        const like = `%${String(b.keyword ?? "").replace(/[%_]/g, "")}%`;
        const records = db
            .prepare(
                `SELECT id, email, nickname, status, role, quota, used_quota AS usedQuota, created_at AS createdAt
                 FROM users WHERE email LIKE ? OR nickname LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?`,
            )
            .all(like, like, size, (Math.max(Number(b.page) || 1, 1) - 1) * size);
        return ok({ records });
    });

    // 手动调额：增加或扣减都经过唯一的入账/扣减入口，写流水，并记审计
    app.post("/api/admin/user/adjust-quota", async (req) => {
        const b = (req.body ?? {}) as { userId?: number; delta?: number; remark?: string };
        const delta = Number(b.delta);
        if (!Number.isSafeInteger(delta) || delta === 0) return fail("调整值无效");
        try {
            const balance = tx(db, () => {
                const r =
                    delta > 0
                        ? credit(db, Number(b.userId), delta, "admin_adjust", { type: "admin", id: (req as any).admin.id })
                        : debit(db, Number(b.userId), -delta, "admin_adjust", { type: "admin", id: (req as any).admin.id });
                audit(req, "adjust_quota", String(b.userId), { delta, remark: b.remark ?? "" });
                return r;
            });
            return ok({ balance });
        } catch (e) {
            if (e instanceof InsufficientQuota || e instanceof WalletError) return fail(e.message);
            throw e;
        }
    });

    app.post("/api/admin/user/set-status", async (req) => {
        const b = (req.body ?? {}) as { userId?: number; status?: number };
        if (b.status !== 0 && b.status !== 1) return fail("状态无效");
        tx(db, () => {
            db.prepare("UPDATE users SET status = ? WHERE id = ?").run(b.status as number, Number(b.userId));
            if (b.status === 0) {
                // 禁用账号时同时吊销其所有 token
                db.prepare("DELETE FROM api_tokens WHERE user_id = ?").run(Number(b.userId));
            }
            audit(req, "set_status", String(b.userId), { status: b.status });
        });
        return ok({});
    });

    app.post("/api/admin/redemption/create", async (req) => {
        const b = (req.body ?? {}) as { count?: number; quota?: number; batch?: string; expiredTime?: number };
        try {
            const keys = createRedemptions(db, Number(b.count), Number(b.quota), {
                batch: b.batch,
                expiredTime: Number(b.expiredTime) || 0,
            });
            audit(req, "create_redemption", b.batch ?? "", { count: keys.length, quota: b.quota });
            return ok({ keys });
        } catch (e) {
            if (e instanceof RedeemError) return fail(e.message);
            throw e;
        }
    });
    app.post("/api/admin/redemption/list", async (req) => {
        const b = (req.body ?? {}) as { page?: number };
        return ok({ records: listRedemptions(db, Number(b.page) || 1) });
    });

    app.post("/api/admin/plan/list", async () => ok({ records: listPlans(db, true) }));
    app.post("/api/admin/plan/save", async (req) => {
        const b = (req.body ?? {}) as any;
        if (!b.title || !Number.isInteger(b.priceCents) || b.priceCents < 0) return fail("套餐参数无效");
        const id = savePlan(db, b);
        audit(req, "save_plan", String(id), b);
        return ok({ id });
    });

    app.post("/api/admin/model/save", async (req) => {
        try {
            const id = saveModel(db, (req.body ?? {}) as any);
            // 审计里不记录密钥
            const { providerConfig, ...rest } = (req.body ?? {}) as any;
            audit(req, "save_model", String(id), rest);
            return ok({ id });
        } catch (e: any) {
            return fail(String(e?.message ?? e));
        }
    });

    app.post("/api/admin/order/list", async (req) => {
        const b = (req.body ?? {}) as { page?: number };
        return ok({ records: listOrders(db, undefined, Number(b.page) || 1, 50) });
    });
    // 人工补单：管理员核实已收款后手动完成订单，同样幂等
    app.post("/api/admin/order/complete", async (req) => {
        const b = (req.body ?? {}) as { tradeNo?: string };
        const order: any = db.prepare("SELECT provider FROM orders WHERE trade_no = ?").get(String(b.tradeNo ?? ""));
        if (!order) return fail("订单不存在");
        try {
            const r = completeOrder(db, String(b.tradeNo), order.provider, 0, { manual: true });
            audit(req, "complete_order", String(b.tradeNo), r);
            return ok(r);
        } catch (e) {
            if (e instanceof OrderError) return fail(e.message);
            throw e;
        }
    });
};
