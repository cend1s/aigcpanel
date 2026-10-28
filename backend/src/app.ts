import cookie from "@fastify/cookie";
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

export const buildApp = (ctx: AppContext) => {
    const app = Fastify({
        logger: process.env.NODE_ENV !== "test",
        // 图生图/图生视频会把参考图以 data URL 随请求提交
        bodyLimit: 16 * 1024 * 1024,
    });
    app.register(cookie);
    // 支付通道的回调常为表单编码，这里不额外引入依赖，自行解析
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
    });
    app.register(async (instance) => {
        authRoutes(instance, ctx.db);
        appManagerRoutes(instance, ctx.db);
        accountRoutes(instance, ctx);
        payRoutes(instance, ctx);
        cloudRoutes(instance, ctx);
        fileRoutes(instance, ctx.filesDir);
        adminRoutes(instance, ctx);
        webRoutes(instance, ctx.db);
    });
    return app;
};
