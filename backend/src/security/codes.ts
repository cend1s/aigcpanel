import { randomInt } from "node:crypto";
import type { Db } from "../db.js";
import { sha256 } from "../security.js";
import { now } from "../tx.js";
import type { Mailer } from "./mailer.js";

export type CodePurpose = "register" | "reset";

export const CODE_TTL = 10 * 60;
export const CODE_COOLDOWN = 60;
export const CODE_DAILY_LIMIT = 10;
export const CODE_MAX_ATTEMPTS = 5;

export class CodeError extends Error {}

const SUBJECT: Record<CodePurpose, string> = { register: "注册验证码", reset: "重置密码验证码" };

/**
 * 发送邮件验证码。频率限制：同一邮箱同一用途 60 秒一次、每天最多 10 次。
 * 超过冷却时间之前的重复请求直接报错，提示剩余秒数。
 */
export const sendCode = async (
    db: Db,
    mailer: Mailer,
    input: { email: string; purpose: CodePurpose; ip: string; appName: string },
) => {
    const t = now();
    const last: any = db
        .prepare("SELECT created_at FROM verification_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1")
        .get(input.email, input.purpose);
    if (last && t - Number(last.created_at) < CODE_COOLDOWN) {
        throw new CodeError(`发送太频繁，请 ${CODE_COOLDOWN - (t - Number(last.created_at))} 秒后再试`);
    }
    const today: any = db
        .prepare("SELECT COUNT(*) AS c FROM verification_codes WHERE email = ? AND created_at > ?")
        .get(input.email, t - 86400);
    if (Number(today.c) >= CODE_DAILY_LIMIT) {
        throw new CodeError("今天的验证码发送次数已达上限，请明天再试");
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    // 新验证码发出后，同用途的旧验证码全部作废
    db.prepare("UPDATE verification_codes SET used = 1 WHERE email = ? AND purpose = ? AND used = 0").run(
        input.email,
        input.purpose,
    );
    db.prepare(
        `INSERT INTO verification_codes (email, purpose, code_hash, ip, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(input.email, input.purpose, sha256(`${input.email}:${code}`), input.ip.slice(0, 64), t + CODE_TTL, t);
    await mailer.send({
        to: input.email,
        subject: `【${input.appName}】${SUBJECT[input.purpose]}`,
        text: `你的验证码是 ${code}，${CODE_TTL / 60} 分钟内有效。\n如果不是你本人操作，请忽略这封邮件。`,
    });
};

/**
 * 校验验证码：成功即作废；错误时累计次数，超过 5 次该验证码作废，需要重新获取。
 */
export const verifyCode = (db: Db, email: string, purpose: CodePurpose, code: unknown): boolean => {
    const row: any = db
        .prepare(
            "SELECT * FROM verification_codes WHERE email = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1",
        )
        .get(email, purpose);
    if (!row || row.expires_at < now()) return false;
    if (typeof code === "string" && /^\d{6}$/.test(code) && row.code_hash === sha256(`${email}:${code}`)) {
        const r = db.prepare("UPDATE verification_codes SET used = 1 WHERE id = ? AND used = 0").run(row.id);
        return r.changes === 1;
    }
    db.prepare(
        "UPDATE verification_codes SET attempts = attempts + 1, used = CASE WHEN attempts + 1 >= ? THEN 1 ELSE 0 END WHERE id = ?",
    ).run(CODE_MAX_ATTEMPTS, row.id);
    return false;
};
