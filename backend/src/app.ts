import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import type { AppContext } from "./context.js";
import { accountRoutes } from "./routes/account.js";
import { adminRoutes } from "./routes/admin.js";
import { appManagerRoutes } from "./routes/appManager.js";
import { authRoutes } from "./routes/auth.js";
import { cloudRoutes } from "./routes/cloud.js";
import { fileRoutes } from "./routes/files.js";
import { payRoutes } from "./routes/pay.js";
import { webRoutes } from "./routes/web.js";
import { SERVER_VERSION } from "./version.js";

export const buildApp = (ctx: AppContext) => {
    const app = Fastify({
        logger: process.env.NODE_ENV !== "test",
        // 图生图/图生视频会把参考图以 data URL 随请求提交
        bodyLimit: 16 * 1024 * 1024,
        // 部署在反向代理后面时，用 X-Forwarded-For 取真实客户端 IP（限流依赖它）
        trustProxy: ctx.security.trustProxy,
    });
    app.register(cookie);
    if (ctx.security.rateLimit) {
        // 全局按 IP 限流；登录、注册、发验证码等敏感接口在路由上另有更严格的限制。
        // 内置为单进程内存计数，多实例部署时需改用 Redis 存储（@fastify/rate-limit 支持）。
        app.register(rateLimit, {
            global: true,
            max: 600,
            timeWindow: "1 minute",
            errorResponseBuilder: (_req, c) => ({
                statusCode: 429,
                code: 429,
                msg: `请求过于频繁，请 ${Math.ceil(c.ttl / 1000)} 秒后再试`,
                data: {},
            }),
        });
    }
    // 支付通道的回调常为表单编码，这里不额外引入依赖，自行解析
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
    });
    app.get("/api/version", async () => ({ code: 0, msg: "ok", data: { version: SERVER_VERSION } }));
    app.register(async (instance) => {
        authRoutes(instance, ctx);
        appManagerRoutes(instance, ctx.db);
        accountRoutes(instance, ctx);
        payRoutes(instance, ctx);
        cloudRoutes(instance, ctx);
        fileRoutes(instance, ctx.filesDir);
        adminRoutes(instance, ctx);
        webRoutes(instance, ctx.db);
    });
    // 管理后台（Refine 单页应用）：静态文件 + 前端路由回退到 index.html
    // 相对路径按进程工作目录解析（@fastify/static 只接受绝对路径）
    const adminDir = ctx.adminDir ? resolve(ctx.adminDir) : "";
    if (adminDir && existsSync(adminDir)) {
        app.register(fastifyStatic, { root: adminDir, prefix: "/admin/" });
        app.setNotFoundHandler((req, reply) => {
            if (req.method === "GET" && req.url.startsWith("/admin/") && !req.url.startsWith("/admin/assets/")) {
                return reply.sendFile("index.html");
            }
            return reply.code(404).send({ code: 404, msg: "Not Found", data: {} });
        });
    }
    return app;
};
