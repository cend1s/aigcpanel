import type { Db } from "../db.js";
import { now } from "../tx.js";

// 登录失败保护（按邮箱计数，与账号是否存在无关）：
// - 15 分钟窗口内失败 3 次起，要求图形验证码
// - 失败 8 次，锁定 15 分钟
export const FAIL_WINDOW = 15 * 60;
export const CAPTCHA_AFTER = 3;
export const LOCK_AFTER = 8;
export const LOCK_SECONDS = 15 * 60;

export type GuardState = { lockedFor: number; captchaRequired: boolean };

const current = (db: Db, email: string) => {
    const row: any = db.prepare("SELECT * FROM login_failures WHERE email = ?").get(email);
    if (!row) return { count: 0, lockedUntil: 0 };
    // 窗口过期且未处于锁定中：计数作废
    if (now() - Number(row.first_at) > FAIL_WINDOW && Number(row.locked_until) <= now()) {
        db.prepare("DELETE FROM login_failures WHERE email = ?").run(email);
        return { count: 0, lockedUntil: 0 };
    }
    return { count: Number(row.count), lockedUntil: Number(row.locked_until) };
};

export const guardState = (db: Db, email: string): GuardState => {
    const c = current(db, email);
    return {
        lockedFor: Math.max(0, c.lockedUntil - now()),
        captchaRequired: c.count >= CAPTCHA_AFTER,
    };
};

export const recordFailure = (db: Db, email: string): GuardState => {
    const c = current(db, email);
    const count = c.count + 1;
    const lockedUntil = count >= LOCK_AFTER ? now() + LOCK_SECONDS : 0;
    db.prepare(
        `INSERT INTO login_failures (email, count, first_at, locked_until) VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until`,
    ).run(email, count, now(), lockedUntil);
    return guardState(db, email);
};

export const clearFailures = (db: Db, email: string) => {
    db.prepare("DELETE FROM login_failures WHERE email = ?").run(email);
};
