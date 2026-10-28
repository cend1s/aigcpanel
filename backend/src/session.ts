import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "./db.js";
import { findUserByToken, type User } from "./users.js";

export const COOKIE_NAME = "token";

export const setSessionCookie = (reply: FastifyReply, token: string) => {
    reply.setCookie(COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
    });
};

// 桌面端接口用 Api-Token 请求头；网页端用 cookie；enter 跳转时用查询参数换取 cookie
export const tokenFromRequest = (req: FastifyRequest): string | undefined => {
    const header = req.headers["api-token"];
    if (typeof header === "string" && header) {
        return header;
    }
    return req.cookies?.[COOKIE_NAME] || undefined;
};

export const currentUser = (db: Db, req: FastifyRequest): User | null =>
    findUserByToken(db, tokenFromRequest(req));
