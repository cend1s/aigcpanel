import type { Db } from "./db.js";
import { now, tx } from "./tx.js";

// 钱包上限：与 new-api 同样的思路，入账用带条件的单条 UPDATE 原子检查
export const MAX_WALLET_QUOTA = 1_000_000_000_000;

export class WalletError extends Error {}
export class InsufficientQuota extends WalletError {
    constructor() {
        super("额度不足");
    }
}

export type Ref = { type: string; id: string | number };

const writeLedger = (
    db: Db,
    userId: number,
    delta: number,
    reason: string,
    ref?: Ref,
): number => {
    const row: any = db.prepare("SELECT quota FROM users WHERE id = ?").get(userId);
    db.prepare(
        `INSERT INTO quota_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, delta, row.quota, reason, ref?.type ?? "", String(ref?.id ?? ""), now());
    return Number(row.quota);
};

const assertAmount = (amount: number) => {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new WalletError("额度数量无效");
    }
};

/** 唯一的入账入口。undoUsage=true 表示这是对一次消耗的退回，同时冲减 used_quota。 */
export const credit = (
    db: Db,
    userId: number,
    amount: number,
    reason: string,
    ref?: Ref,
    undoUsage = false,
): number =>
    tx(db, () => {
        assertAmount(amount);
        const r = db
            .prepare(
                `UPDATE users SET quota = quota + ?,
                    used_quota = CASE WHEN ? THEN MAX(used_quota - ?, 0) ELSE used_quota END
                 WHERE id = ? AND quota <= ?`,
            )
            .run(amount, undoUsage ? 1 : 0, amount, userId, MAX_WALLET_QUOTA - amount);
        if (r.changes !== 1) {
            const exists = db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId);
            throw new WalletError(exists ? "超出钱包额度上限" : "用户不存在");
        }
        return writeLedger(db, userId, amount, reason, ref);
    });

/** 唯一的扣减入口：余额不足时不修改任何数据。 */
export const debit = (
    db: Db,
    userId: number,
    amount: number,
    reason: string,
    ref?: Ref,
): number =>
    tx(db, () => {
        assertAmount(amount);
        const r = db
            .prepare(
                `UPDATE users SET quota = quota - ?, used_quota = used_quota + ?
                 WHERE id = ? AND quota >= ?`,
            )
            .run(amount, amount, userId, amount);
        if (r.changes !== 1) {
            throw new InsufficientQuota();
        }
        return writeLedger(db, userId, -amount, reason, ref);
    });

export const getBalance = (db: Db, userId: number) => {
    const row: any = db
        .prepare("SELECT quota, used_quota FROM users WHERE id = ?")
        .get(userId);
    return row ? { quota: Number(row.quota), usedQuota: Number(row.used_quota) } : null;
};

export const listLedger = (db: Db, userId: number, page = 1, pageSize = 20) => {
    pageSize = Math.min(Math.max(pageSize, 1), 100);
    const offset = (Math.max(page, 1) - 1) * pageSize;
    const total: any = db
        .prepare("SELECT COUNT(*) AS c FROM quota_ledger WHERE user_id = ?")
        .get(userId);
    const records = db
        .prepare(
            `SELECT id, delta, balance_after AS balanceAfter, reason, ref_type AS refType,
                    ref_id AS refId, created_at AS createdAt
             FROM quota_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(userId, pageSize, offset);
    return { total: Number(total.c), records };
};
