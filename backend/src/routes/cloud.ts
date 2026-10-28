import type { FastifyInstance } from "fastify";
import { publicModelRecords } from "../cloud/models.js";
import { checkTask, refreshTask, submitTask, TaskError } from "../cloud/tasks.js";
import type { AppContext } from "../context.js";
import { fail, ok } from "../response.js";
import { isFailure, requireUser } from "../session.js";

export const cloudRoutes = (app: FastifyInstance, { db, providers }: AppContext) => {
    // 客户端 serverCloud store 启动时拉取（不需要登录）
    app.post("/api/server/all", async () => ok({ records: publicModelRecords(db) }));

    // 云端形象模板：电商方向暂未提供，返回空列表保证客户端不报错
    app.post("/api/aigcpanel/video_template/all", async () => ok({ records: [] }));
    app.post("/api/aigcpanel/video_template/get", async () => fail("模板不存在"));

    // 客户端 PermissionService.checkForTask：额度不足时 data.type = "CreditNotEnough"，客户端会引导充值
    app.post("/api/aigcpanel/task/check", async (req) => {
        const user = requireUser(db, req);
        if (isFailure(user)) return user;
        const b = (req.body ?? {}) as { model?: string; version?: string };
        try {
            checkTask(db, user.id, String(b.model ?? ""), String(b.version ?? ""));
            return ok({});
        } catch (e) {
            if (e instanceof TaskError) return fail(e.message, -1, { type: e.type });
            throw e;
        }
    });

    app.post("/api/cloud/task/submit", async (req) => {
        const user = requireUser(db, req);
        if (isFailure(user)) return user;
        const b = (req.body ?? {}) as { model?: string; version?: string; param?: unknown };
        try {
            return ok(
                await submitTask(db, providers, user.id, {
                    model: String(b.model ?? ""),
                    version: String(b.version ?? ""),
                    param: b.param,
                }),
            );
        } catch (e) {
            if (e instanceof TaskError) return fail(e.message, -1, { type: e.type });
            throw e;
        }
    });

    app.post("/api/cloud/task/status", async (req) => {
        const user = requireUser(db, req);
        if (isFailure(user)) return user;
        const b = (req.body ?? {}) as { id?: string };
        try {
            return ok(await refreshTask(db, providers, String(b.id ?? ""), user.id));
        } catch (e) {
            if (e instanceof TaskError) return fail(e.message, -1, { type: e.type });
            throw e;
        }
    });
};
