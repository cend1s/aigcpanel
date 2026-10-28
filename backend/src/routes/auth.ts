import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { userPayload } from "../payload.js";
import { fail, ok } from "../response.js";
import { COOKIE_NAME, setSessionCookie } from "../session.js";
import { issueToken, login, register, revokeToken, UserError } from "../users.js";

type Body = {
    email?: string;
    password?: string;
    nickname?: string;
    deviceUuid?: string;
};

export const authRoutes = (app: FastifyInstance, db: Db) => {
    app.post("/api/auth/register", async (req, reply) => {
        const body = (req.body ?? {}) as Body;
        try {
            const user = register(db, body.email ?? "", body.password ?? "", body.nickname);
            const token = issueToken(db, user.id, body.deviceUuid);
            setSessionCookie(reply, token);
            return ok(userPayload(user, token));
        } catch (e) {
            if (e instanceof UserError) {
                return fail(e.message);
            }
            throw e;
        }
    });

    app.post("/api/auth/login", async (req, reply) => {
        const body = (req.body ?? {}) as Body;
        try {
            const user = login(db, body.email ?? "", body.password ?? "");
            const token = issueToken(db, user.id, body.deviceUuid);
            setSessionCookie(reply, token);
            return ok(userPayload(user, token));
        } catch (e) {
            if (e instanceof UserError) {
                return fail(e.message);
            }
            throw e;
        }
    });

    app.post("/api/auth/logout", async (req, reply) => {
        revokeToken(db, req.cookies?.[COOKIE_NAME]);
        const header = req.headers["api-token"];
        if (typeof header === "string") {
            revokeToken(db, header);
        }
        reply.clearCookie(COOKIE_NAME, { path: "/" });
        return ok({});
    });
};
