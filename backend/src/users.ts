import type { Db } from "./db.js";
import { hashPassword, newToken, sha256, verifyPassword } from "./security.js";

export type User = {
    id: number;
    email: string;
    nickname: string;
    avatar: string;
    status: number;
    role: number;
    quota: number;
};

export const ROLE_ADMIN = 100;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserError extends Error {}

const now = () => Math.floor(Date.now() / 1000);

const toUser = (row: any): User => ({
    id: Number(row.id),
    email: row.email,
    nickname: row.nickname,
    avatar: row.avatar,
    status: Number(row.status),
    role: Number(row.role ?? 1),
    quota: Number(row.quota),
});

export const normalizeEmail = (email: unknown) => String(email ?? "").trim().toLowerCase();

export const assertEmail = (email: string) => {
    if (!EMAIL_RE.test(email) || email.length > 100) {
        throw new UserError("邮箱格式不正确");
    }
};

export const assertPassword = (password: unknown) => {
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
        throw new UserError("密码长度需为 8-128 位");
    }
    // 至少包含字母和数字两类字符，挡住 12345678 这类弱密码
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        throw new UserError("密码需同时包含字母和数字");
    }
};

export const register = (
    db: Db,
    email: string,
    password: string,
    nickname?: string,
    emailVerified = false,
): User => {
    email = normalizeEmail(email);
    assertEmail(email);
    assertPassword(password);
    const exists = db.prepare("SELECT 1 FROM users WHERE email = ?").get(email);
    if (exists) {
        throw new UserError("该邮箱已注册");
    }
    const name = (nickname || "").trim().slice(0, 20) || email.split("@")[0];
    const result = db
        .prepare(
            "INSERT INTO users (email, password_hash, nickname, email_verified, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(email, hashPassword(password), name, emailVerified ? 1 : 0, now());
    return getUser(db, Number(result.lastInsertRowid))!;
};

export const getUser = (db: Db, id: number): User | null => {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ? toUser(row) : null;
};

export const login = (db: Db, email: string, password: string): User => {
    const row: any = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get((email || "").trim().toLowerCase());
    // 用户不存在与密码错误返回同一提示，避免枚举账号
    if (!row || !verifyPassword(String(password ?? ""), row.password_hash)) {
        throw new UserError("邮箱或密码错误");
    }
    if (row.status !== 1) {
        throw new UserError("账号已被禁用");
    }
    return toUser(row);
};

export const userExists = (db: Db, email: string) =>
    !!db.prepare("SELECT 1 FROM users WHERE email = ?").get(normalizeEmail(email));

/** 重置密码：同时吊销该用户所有已登录的 token（包括桌面端），强制重新登录。 */
export const resetPassword = (db: Db, email: string, password: string) => {
    assertPassword(password);
    const row: any = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizeEmail(email));
    if (!row) {
        throw new UserError("账号不存在");
    }
    db.prepare("UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?").run(hashPassword(password), row.id);
    db.prepare("DELETE FROM api_tokens WHERE user_id = ?").run(row.id);
};

export const issueToken = (db: Db, userId: number, deviceUuid = ""): string => {
    const token = newToken();
    const t = now();
    db.prepare(
        "INSERT INTO api_tokens (token_hash, user_id, device_uuid, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)",
    ).run(sha256(token), userId, deviceUuid.slice(0, 64), t, t);
    return token;
};

export const findUserByToken = (db: Db, token: string | undefined): User | null => {
    if (!token) {
        return null;
    }
    const row: any = db
        .prepare(
            `SELECT u.* FROM api_tokens t JOIN users u ON u.id = t.user_id
             WHERE t.token_hash = ? AND u.status = 1`,
        )
        .get(sha256(token));
    if (!row) {
        return null;
    }
    db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?").run(
        now(),
        sha256(token),
    );
    return toUser(row);
};

export const revokeToken = (db: Db, token: string | undefined): void => {
    if (token) {
        db.prepare("DELETE FROM api_tokens WHERE token_hash = ?").run(sha256(token));
    }
};
