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

export const register = (
    db: Db,
    email: string,
    password: string,
    nickname?: string,
): User => {
    email = (email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 100) {
        throw new UserError("邮箱格式不正确");
    }
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
        throw new UserError("密码长度需为 8-128 位");
    }
    const exists = db.prepare("SELECT 1 FROM users WHERE email = ?").get(email);
    if (exists) {
        throw new UserError("该邮箱已注册");
    }
    const name = (nickname || "").trim().slice(0, 20) || email.split("@")[0];
    const result = db
        .prepare(
            "INSERT INTO users (email, password_hash, nickname, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(email, hashPassword(password), name, now());
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
