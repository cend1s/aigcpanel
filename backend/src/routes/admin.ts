import type { FastifyInstance, FastifyRequest } from "fastify";
import { saveModel } from "../cloud/models.js";
import type { AppContext } from "../context.js";
import type { Db } from "../db.js";
import { completeOrder, OrderError } from "../pay/orders.js";
import { getPlan, savePlan } from "../plans.js";
import { createRedemptions, RedeemError } from "../redeem.js";
import { fail, ok } from "../response.js";
import { isFailure, requireUser } from "../session.js";
import { now, tx } from "../tx.js";
import { ROLE_ADMIN, type User } from "../users.js";
import { credit, debit, InsufficientQuota, WalletError } from "../wallet.js";

type ListBody = { page?: number; pageSize?: number; keyword?: string; status?: string };

/** 统一分页：返回 { records, total }，供管理后台的表格分页使用。 */
const paginate = (
    db: Db,
    from: string,
    where: string[],
    args: any[],
    body: ListBody,
    select = "*",
    order = "id DESC",
) => {
    const size = Math.min(Math.max(Number(body.pageSize) || 20, 1), 100);
    const page = Math.max(Number(body.page) || 1, 1);
    const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total: any = db.prepare(`SELECT COUNT(*) AS c FROM ${from} ${w}`).get(...args);
    const records = db
        .prepare(`SELECT ${select} FROM ${from} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...args, size, (page - 1) * size);
    return { records, total: Number(total.c) };
};

// LIKE 的通配符按字面量匹配：转义 %、_ 和反斜杠，配合 SQL 里的 ESCAPE 子句
const likeArg = (s: unknown) => `%${String(s ?? "").replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const LIKE = "LIKE ? ESCAPE '\\'";

// 供应商配置里的密钥字段：列表与详情只返回脱敏值；保存时若仍是脱敏值或留空，则保留原值
const SECRET_KEY_RE = /key|secret|token|password/i;
const MASK = "******";
export const maskConfig = (cfg: Record<string, any>) =>
    Object.fromEntries(
        Object.entries(cfg ?? {}).map(([k, v]) =>
            SECRET_KEY_RE.test(k) && typeof v === "string" && v
                ? [k, `${MASK}${v.slice(-4)}`]
                : [k, v],
        ),
    );
export const mergeSecrets = (incoming: Record<string, any>, old: Record<string, any>) =>
    Object.fromEntries(
        Object.entries(incoming ?? {}).map(([k, v]) =>
            SECRET_KEY_RE.test(k) && (v === "" || (typeof v === "string" && v.startsWith(MASK)))
                ? [k, old?.[k] ?? ""]
                : [k, v],
        ),
    );

const modelView = (r: any) => ({
    id: Number(r.id),
    name: r.name,
    version: r.version,
    title: r.title,
    description: r.description,
    logo: r.logo,
    content: r.content,
    functions: JSON.parse(r.functions || "{}"),
    provider: r.provider,
    providerConfig: maskConfig(JSON.parse(r.provider_config || "{}")),
    pricing: JSON.parse(r.pricing || "{}"),
    enabled: !!r.enabled,
});

export const adminRoutes = (app: FastifyInstance, { db, providers }: AppContext) => {
    // 管理接口统一鉴权：非管理员一律 403
    app.addHook("preHandler", async (req, reply) => {
        if (!req.url.startsWith("/api/admin/")) return;
        const user = requireUser(db, req);
        if (isFailure(user) || user.role < ROLE_ADMIN) {
            return reply.code(403).send({ code: 403, msg: "无权限", data: {} });
        }
        (req as any).admin = user;
    });

    const adminOf = (req: FastifyRequest) => (req as any).admin as User;
    const audit = (req: FastifyRequest, action: string, target: string, detail: unknown) =>
        db
            .prepare("INSERT INTO audit_logs (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(adminOf(req).id, action, target, JSON.stringify(detail), now());
    const body = (req: FastifyRequest) => (req.body ?? {}) as any;

    app.post("/api/admin/me", async (req) => {
        const u = adminOf(req);
        return ok({ id: u.id, email: u.email, nickname: u.nickname });
    });

    // ── 概览 ──────────────────────────────────────────────
    app.post("/api/admin/stats", async () => {
        const dayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
        const one = (sql: string, ...a: any[]) => Number((db.prepare(sql).get(...a) as any).v ?? 0);
        const revenue = db
            .prepare(
                `SELECT date(paid_at, 'unixepoch', 'localtime') AS day, SUM(money_cents) AS cents, COUNT(*) AS orders
                 FROM orders WHERE status = 'paid' AND paid_at >= ? GROUP BY day ORDER BY day`,
            )
            .all(dayStart - 6 * 86400);
        return ok({
            users: one("SELECT COUNT(*) AS v FROM users"),
            usersToday: one("SELECT COUNT(*) AS v FROM users WHERE created_at >= ?", dayStart),
            revenueTodayCents: one("SELECT SUM(money_cents) AS v FROM orders WHERE status='paid' AND paid_at >= ?", dayStart),
            tasksToday: one("SELECT COUNT(*) AS v FROM cloud_tasks WHERE created_at >= ?", dayStart),
            tasksFailedToday: one("SELECT COUNT(*) AS v FROM cloud_tasks WHERE created_at >= ? AND status='failed'", dayStart),
            quotaUsedToday: one("SELECT SUM(settled) AS v FROM cloud_tasks WHERE created_at >= ? AND status='succeeded'", dayStart),
            revenue7d: revenue,
        });
    });

    // ── 用户 ──────────────────────────────────────────────
    app.post("/api/admin/user/list", async (req) => {
        const b: ListBody = body(req);
        const where: string[] = [];
        const args: any[] = [];
        if (b.keyword) {
            where.push(`(email ${LIKE} OR nickname ${LIKE})`);
            args.push(likeArg(b.keyword), likeArg(b.keyword));
        }
        return ok(
            paginate(db, "users", where, args, b,
                "id, email, nickname, status, role, quota, used_quota AS usedQuota, created_at AS createdAt"),
        );
    });

    // 手动调额：增加或扣减都经过唯一的入账/扣减入口，写流水，并记审计
    app.post("/api/admin/user/adjust-quota", async (req) => {
        const b = body(req) as { userId?: number; delta?: number; remark?: string };
        const delta = Number(b.delta);
        if (!Number.isSafeInteger(delta) || delta === 0) return fail("调整值无效");
        try {
            const balance = tx(db, () => {
                const ref = { type: "admin", id: adminOf(req).id };
                const r =
                    delta > 0
                        ? credit(db, Number(b.userId), delta, "admin_adjust", ref)
                        : debit(db, Number(b.userId), -delta, "admin_adjust", ref);
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
        const b = body(req) as { userId?: number; status?: number };
        if (b.status !== 0 && b.status !== 1) return fail("状态无效");
        if (Number(b.userId) === adminOf(req).id) return fail("不能禁用自己");
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

    app.post("/api/admin/user/ledger", async (req) => {
        const b = body(req) as ListBody & { userId?: number };
        return ok(
            paginate(db, "quota_ledger", ["user_id = ?"], [Number(b.userId)], b,
                "id, delta, balance_after AS balanceAfter, reason, ref_type AS refType, ref_id AS refId, created_at AS createdAt"),
        );
    });

    // ── 兑换码 ────────────────────────────────────────────
    app.post("/api/admin/redemption/create", async (req) => {
        const b = body(req) as { count?: number; quota?: number; batch?: string; expiredTime?: number };
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
        const b: ListBody = body(req);
        const where: string[] = [];
        const args: any[] = [];
        if (b.keyword) {
            where.push(`(batch ${LIKE} OR key = ?)`);
            args.push(likeArg(b.keyword), String(b.keyword));
        }
        if (b.status) {
            where.push("status = ?");
            args.push(Number(b.status));
        }
        return ok(paginate(db, "redemptions", where, args, b));
    });

    // ── 套餐 ──────────────────────────────────────────────
    app.post("/api/admin/plan/list", async (req) => {
        const r = paginate(db, "plans", [], [], body(req), "*", "sort, id");
        return ok({ ...r, records: r.records.map((p: any) => getPlan(db, Number(p.id))) });
    });
    app.post("/api/admin/plan/get", async (req) => {
        const p = getPlan(db, Number(body(req).id));
        return p ? ok(p) : fail("套餐不存在");
    });
    app.post("/api/admin/plan/save", async (req) => {
        const b = body(req);
        if (!b.title || !Number.isInteger(b.priceCents) || b.priceCents < 0) return fail("套餐参数无效");
        if (!Number.isInteger(b.durationDays) || b.durationDays <= 0) return fail("有效天数无效");
        if (!Number.isInteger(b.quota) || b.quota < 0) return fail("额度无效");
        const id = savePlan(db, b);
        audit(req, "save_plan", String(id), b);
        return ok({ id });
    });

    // ── 云端模型 ──────────────────────────────────────────
    app.post("/api/admin/model/providers", async () => ok({ records: providers.names() }));
    app.post("/api/admin/model/list", async (req) => {
        const r = paginate(db, "cloud_models", [], [], body(req), "*", "id");
        return ok({ ...r, records: r.records.map(modelView) });
    });
    app.post("/api/admin/model/get", async (req) => {
        const r = db.prepare("SELECT * FROM cloud_models WHERE id = ?").get(Number(body(req).id));
        return r ? ok(modelView(r)) : fail("模型不存在");
    });
    app.post("/api/admin/model/save", async (req) => {
        const b = body(req);
        try {
            const old: any = db
                .prepare("SELECT provider_config FROM cloud_models WHERE name = ? AND version = ?")
                .get(String(b.name ?? ""), String(b.version ?? ""));
            const providerConfig = mergeSecrets(b.providerConfig ?? {}, old ? JSON.parse(old.provider_config) : {});
            if (b.provider && !providers.get(b.provider)) return fail(`供应商未启用：${b.provider}`);
            const id = saveModel(db, { ...b, providerConfig });
            // 审计里不记录密钥
            audit(req, "save_model", String(id), { ...b, providerConfig: maskConfig(providerConfig) });
            return ok({ id });
        } catch (e: any) {
            return fail(String(e?.message ?? e));
        }
    });

    // ── 订单 ──────────────────────────────────────────────
    app.post("/api/admin/order/list", async (req) => {
        const b: ListBody = body(req);
        const where: string[] = [];
        const args: any[] = [];
        if (b.keyword) {
            where.push(`(o.trade_no = ? OR u.email ${LIKE})`);
            args.push(String(b.keyword), likeArg(b.keyword));
        }
        if (b.status) {
            where.push("o.status = ?");
            args.push(String(b.status));
        }
        return ok(
            paginate(db, "orders o JOIN users u ON u.id = o.user_id", where, args, b,
                `o.id, o.trade_no AS tradeNo, o.kind, o.plan_id AS planId, o.quota, o.money_cents AS moneyCents,
                 o.provider, o.method, o.status, o.created_at AS createdAt, o.paid_at AS paidAt, u.email`,
                "o.id DESC"),
        );
    });
    // 人工补单：管理员核实已收款后手动完成订单，同样幂等
    app.post("/api/admin/order/complete", async (req) => {
        const b = body(req) as { tradeNo?: string };
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

    // ── 云端任务、审计 ────────────────────────────────────
    app.post("/api/admin/task/list", async (req) => {
        const b: ListBody = body(req);
        const where: string[] = [];
        const args: any[] = [];
        if (b.status) {
            where.push("t.status = ?");
            args.push(String(b.status));
        }
        if (b.keyword) {
            where.push(`(u.email ${LIKE} OR m.name ${LIKE})`);
            args.push(likeArg(b.keyword), likeArg(b.keyword));
        }
        return ok(
            paginate(db, "cloud_tasks t JOIN users u ON u.id = t.user_id JOIN cloud_models m ON m.id = t.model_id", where, args, b,
                `t.id, t.status, t.reserved, t.settled, t.error, t.created_at AS createdAt, t.updated_at AS updatedAt,
                 u.email, m.name AS model`,
                "t.created_at DESC"),
        );
    });
    app.post("/api/admin/audit/list", async (req) => {
        const b: ListBody = body(req);
        const where: string[] = [];
        const args: any[] = [];
        if (b.keyword) {
            where.push(`(a.action ${LIKE} OR a.target ${LIKE})`);
            args.push(likeArg(b.keyword), likeArg(b.keyword));
        }
        return ok(
            paginate(db, "audit_logs a LEFT JOIN users u ON u.id = a.actor_id", where, args, b,
                "a.id, a.action, a.target, a.detail, a.created_at AS createdAt, u.email AS actor", "a.id DESC"),
        );
    });
};
