import type { Db } from "./db.js";
import { activeSubscriptions } from "./plans.js";
import { tx } from "./tx.js";
import { credit, debit, getBalance, InsufficientQuota, type Ref } from "./wallet.js";

// 扣费来源：先用订阅额度（先到期先用），不足部分回落到钱包余额。
export type Funding = { wallet: number; subs: { id: number; amount: number }[] };

export const fundingTotal = (f: Funding) =>
    f.wallet + f.subs.reduce((s, x) => s + x.amount, 0);

export const availableQuota = (db: Db, userId: number): number =>
    (getBalance(db, userId)?.quota ?? 0) +
    activeSubscriptions(db, userId).reduce((s, x) => s + x.remaining, 0);

/** 预扣：额度不足时抛 InsufficientQuota，且不修改任何数据。 */
export const reserveFunds = (db: Db, userId: number, amount: number, ref: Ref): Funding =>
    tx(db, () => {
        const funding: Funding = { wallet: 0, subs: [] };
        let left = amount;
        for (const sub of activeSubscriptions(db, userId)) {
            if (left <= 0) break;
            const take = Math.min(sub.remaining, left);
            if (take <= 0) continue;
            const r = db
                .prepare(
                    `UPDATE subscriptions SET quota_used = quota_used + ?
                     WHERE id = ? AND quota_total - quota_used >= ?`,
                )
                .run(take, sub.id, take);
            if (r.changes === 1) {
                funding.subs.push({ id: sub.id, amount: take });
                left -= take;
            }
        }
        if (left > 0) {
            debit(db, userId, left, "task_reserve", ref); // 余额不足会抛错并回滚整个预扣
            funding.wallet = left;
        }
        return funding;
    });

/** 释放（退回）一部分已预扣的额度：先退钱包，再退订阅。返回剩余的 Funding。 */
export const releaseFunds = (
    db: Db,
    userId: number,
    funding: Funding,
    amount: number,
    ref: Ref,
    reason: string,
): Funding =>
    tx(db, () => {
        const rest: Funding = { wallet: funding.wallet, subs: funding.subs.map((s) => ({ ...s })) };
        let left = Math.min(amount, fundingTotal(rest));
        if (left > 0 && rest.wallet > 0) {
            const back = Math.min(rest.wallet, left);
            credit(db, userId, back, reason, ref, true);
            rest.wallet -= back;
            left -= back;
        }
        for (const s of rest.subs) {
            if (left <= 0) break;
            const back = Math.min(s.amount, left);
            db.prepare("UPDATE subscriptions SET quota_used = MAX(quota_used - ?, 0) WHERE id = ?").run(back, s.id);
            s.amount -= back;
            left -= back;
        }
        rest.subs = rest.subs.filter((s) => s.amount > 0);
        return rest;
    });

/** 实际消耗超过预扣时的补扣：尽力而为，余额不够就扣到 0，返回实际补扣的额度。 */
export const chargeExtra = (db: Db, userId: number, amount: number, ref: Ref): number =>
    tx(db, () => {
        const wallet = getBalance(db, userId)?.quota ?? 0;
        const take = Math.min(wallet, amount);
        if (take > 0) {
            try {
                debit(db, userId, take, "task_extra", ref);
            } catch (e) {
                if (!(e instanceof InsufficientQuota)) throw e;
                return 0;
            }
        }
        return take;
    });
