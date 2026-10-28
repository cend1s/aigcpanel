import cookie from "@fastify/cookie";
import Fastify from "fastify";
import type { Db } from "./db.js";
import { appManagerRoutes } from "./routes/appManager.js";
import { authRoutes } from "./routes/auth.js";
import { webRoutes } from "./routes/web.js";

export const buildApp = (db: Db) => {
    const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
    app.register(cookie);
    app.register(async (instance) => {
        authRoutes(instance, db);
        appManagerRoutes(instance, db);
        webRoutes(instance, db);
    });
    return app;
};
