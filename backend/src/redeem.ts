import { randomBytes } from "node:crypto";
import type { Db } from "./db.js";
import { now, tx } from "./tx.js";
import { credit, WalletError } from "./wallet.js";

export class RedeemError extends Error {}

export const createRedemptions = (
    db: Db,
    count: number,
    quota: number,
    opts: { batch?: string; expiredTime?: number } = {},
): string[] => {
    if (!Number.isInteger(count) || count < 1 || count > 1000) {
        throw new RedeemError("数量需为 1-1000");
    }
    if (!Number.isSafeInteger(quota) || quota <= 0) {
        throw new RedeemError("额度无效");
    }
    return tx(db, () => {
        const keys: string[] = [];
        const stmt = db.prepare(
            `INSERT INTO redemptions (key, quota, batch, expired_time, created_at) VALUES (?, ?, ?, ?, ?)`,
        );
        for (let i = 0; i < count; i++) {
            const key = randomBytes(16).toString("hex");
            stmt.run(key, quota, opts.batch ?? "", opts.expiredTime ?? 0, now());
            keys.push(key);
        }
        return keys;
    });
};

// 兑换：状态 CAS（WHERE status = 1），只有把“可用”改成“已用”的那次调用才能入账。
export const redeem = async (db: Db, key: string, userId: number): Promise<number> => {
    // 随机延迟，增加枚举兑换码的成本
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 50)));
    try {
        return tx(db, () => {
            const row: any = db.prepare("SELECT * FROM redemptions WHERE key = ?").get(String(key ?? ""));
            if (!row) {
                throw new RedeemError("兑换码无效");
            }
            if (row.status !== 1) {
                throw new RedeemError("兑换码已被使用");
            }
            if (row.expired_time !== 0 && row.expired_time < now()) {
                throw new RedeemError("兑换码已过期");
            }
            const r = db
                .prepare(
                    `UPDATE redemptions SET status = 2, used_user_id = ?, redeemed_time = ?
                     WHERE id = ? AND status = 1`,
                )
                .run(userId, now(), row.id);
            if (r.changes !== 1) {
                throw new RedeemError("兑换码已被使用");
            }
            credit(db, userId, Number(row.quota), "redeem", { type: "redemption", id: row.id });
            return Number(row.quota);
        });
    } catch (e) {
        if (e instanceof WalletError) {
            throw new RedeemError(e.message);
        }
        throw e;
    }
};

export const listRedemptions = (db: Db, page = 1, pageSize = 50) => {
    pageSize = Math.min(Math.max(pageSize, 1), 200);
    return db
        .prepare("SELECT * FROM redemptions ORDER BY id DESC LIMIT ? OFFSET ?")
        .all(pageSize, (Math.max(page, 1) - 1) * pageSize);
};
