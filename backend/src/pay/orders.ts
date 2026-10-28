import { randomBytes } from "node:crypto";
import type { Db } from "../db.js";
import { activatePlan, getPlan } from "../plans.js";
import { now, tx } from "../tx.js";
import { credit } from "../wallet.js";

export class OrderError extends Error {}

// 1 元对应的额度。可通过环境变量调整，充值订单创建时就固化为 order.quota，之后改配置不影响已建订单。
export const quotaPerYuan = () => Number(process.env.QUOTA_PER_YUAN ?? 1000);
export const MIN_TOPUP_CENTS = 100;
export const MAX_TOPUP_CENTS = 1_000_000;

const newTradeNo = () => `T${Date.now()}${randomBytes(4).toString("hex")}`;

export const createOrder = (
    db: Db,
    input: {
        userId: number;
        kind: "topup" | "plan";
        provider: string;
        method: string;
        amountCents?: number;
        planId?: number;
    },
) => {
    let moneyCents: number;
    let quota = 0;
    let planId = 0;
    let subject: string;
    if (input.kind === "topup") {
        moneyCents = Number(input.amountCents);
        if (!Number.isInteger(moneyCents) || moneyCents < MIN_TOPUP_CENTS || moneyCents > MAX_TOPUP_CENTS) {
            throw new OrderError("充值金额需在 1 元到 10000 元之间");
        }
        quota = Math.floor((moneyCents * quotaPerYuan()) / 100);
        subject = "额度充值";
    } else {
        const plan = getPlan(db, Number(input.planId));
        if (!plan || !plan.enabled) {
            throw new OrderError("套餐不存在或已下架");
        }
        moneyCents = plan.priceCents; // 金额以服务端套餐价格为准，不信任客户端
        planId = plan.id;
        subject = plan.title;
    }
    const tradeNo = newTradeNo();
    db.prepare(
        `INSERT INTO orders (user_id, trade_no, kind, plan_id, quota, money_cents, provider, method, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(input.userId, tradeNo, input.kind, planId, quota, moneyCents, input.provider, input.method, now());
    return { tradeNo, moneyCents, subject };
};

export type CompleteResult = { alreadyDone: boolean };

/**
 * 支付成功后的统一处理，同一订单无论回调多少次、并发多少次，只会入账一次：
 * 事务内读订单 → 校验通道与金额 → 状态 CAS（pending → paid）→ 入账或开通订阅。
 */
export const completeOrder = (
    db: Db,
    tradeNo: string,
    provider: string,
    paidCents: number,
    opts: { manual?: boolean } = {},
): CompleteResult =>
    tx(db, () => {
        const order: any = db.prepare("SELECT * FROM orders WHERE trade_no = ?").get(tradeNo);
        if (!order) {
            throw new OrderError("订单不存在");
        }
        if (order.provider !== provider) {
            throw new OrderError("支付通道与订单不一致");
        }
        if (order.status === "paid") {
            return { alreadyDone: true };
        }
        if (order.status !== "pending") {
            throw new OrderError("订单状态不允许支付");
        }
        // 人工补单（管理员核实收款后）不比对金额；通道回调必须与订单金额一致
        if (!opts.manual && paidCents !== Number(order.money_cents)) {
            throw new OrderError("支付金额与订单不一致");
        }
        const cas = db
            .prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'")
            .run(now(), order.id);
        if (cas.changes !== 1) {
            return { alreadyDone: true };
        }
        if (order.kind === "topup") {
            credit(db, Number(order.user_id), Number(order.quota), "topup", { type: "order", id: order.trade_no });
        } else {
            activatePlan(db, Number(order.user_id), Number(order.plan_id), Number(order.id));
        }
        return { alreadyDone: false };
    });

export const listOrders = (db: Db, userId?: number, page = 1, pageSize = 20) => {
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const where = userId ? "WHERE user_id = ?" : "";
    const args: any[] = userId ? [userId] : [];
    return db
        .prepare(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
        .all(...args, pageSize, (Math.max(page, 1) - 1) * pageSize);
};
