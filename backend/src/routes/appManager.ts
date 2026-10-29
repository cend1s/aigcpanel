import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import { userPayload } from "../payload.js";
import { functionsFor } from "../plans.js";
import { ok } from "../response.js";
import { setSessionCookie, tokenFromRequest } from "../session.js";
import { findUserByToken } from "../users.js";

const DEFAULT_PAGE = "/app_manager/user";

// 只允许站内相对路径，防止 enter 被用作开放重定向
export const safeRedirect = (url: unknown): string => {
    if (
        typeof url !== "string" ||
        !url.startsWith("/") ||
        url.startsWith("//") ||
        url.includes("\\") ||
        /[\r\n]/.test(url)
    ) {
        return DEFAULT_PAGE;
    }
    return url;
};

export const appManagerRoutes = (app: FastifyInstance, db: Db) => {
    // 桌面端启动时检查更新（地址不带 /api 前缀）。没有这个接口时客户端会把 404 弹成「Not Found」。
    // 暂不做在线更新：原样返回客户端当前版本，表示已是最新。
    app.post("/app_manager/updater/open", async (req) => {
        const b = (req.body ?? {}) as { version?: string };
        return ok({ version: String(b.version ?? "") });
    });
    // 桌面端的使用统计上报：目前只接收不存储
    app.post("/app_manager/collect", async () => ok({}));

    // 注意：本接口永远不能返回 1001。
    // 客户端收到 1001 会调用 refresh()，而 refresh() 又请求本接口，会无限递归。
    // 未登录或 token 失效时返回 code 0 + 空用户，客户端据此清除登录态。
    app.post("/api/app_manager/user_info", async (req) => {
        const token = tokenFromRequest(req) ?? "";
        const user = findUserByToken(db, token);
        return ok(userPayload(user, token, user ? functionsFor(db, user.id) : {}));
    });

    // 在系统浏览器打开：用 api_token 换取网页会话 cookie，再跳转到站内页面
    app.get("/api/app_manager/enter", async (req, reply) => {
        const q = req.query as Record<string, string | undefined>;
        const user = findUserByToken(db, q.api_token);
        if (!user || !q.api_token) {
            return reply.redirect("/login", 302);
        }
        setSessionCookie(reply, q.api_token);
        return reply.redirect(safeRedirect(q.url), 302);
    });

    // 应用内用户窗口（webview）入口
    app.get("/api/app_manager/user_web", async (req, reply) => {
        const q = req.query as Record<string, string | undefined>;
        const user = findUserByToken(db, q.api_token);
        if (!user || !q.api_token) {
            return reply.redirect(`/login${q.is_dark ? "?is_dark=1" : ""}`, 302);
        }
        setSessionCookie(reply, q.api_token);
        return reply.redirect(
            `${DEFAULT_PAGE}${q.is_dark ? "?is_dark=1" : ""}`,
            302,
        );
    });
};
