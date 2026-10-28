import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { activeSubscriptions, listPlans } from "../plans.js";
import { redeem, RedeemError } from "../redeem.js";
import { fail, ok } from "../response.js";
import { isFailure, requireUser } from "../session.js";
import { getBalance, listLedger } from "../wallet.js";

export const accountRoutes = (app: FastifyInstance, { db }: AppContext) => {
    app.post("/api/account/balance", async (req) => {
        const user = requireUser(db, req);
        if (isFailure(user)) return user;
        return ok({
            ...getBalance(db, user.id),
            subscriptions: activeSubscriptions(db, user.id).map(({ functions, ...s }) => s),
        });
    });

    app.post("/api/account/ledger", async (req) => {
        const user = requireUser(db, req);
        if (isFailure(user)) return user;
        const b = (req.body ?? {}) as { page?: number; pageSize?: number };
        return ok(listLedger(db, user.id, Number(b.page) || 1, Number(b.pageSize) || 20));
    });

    app.post("/api/account/redeem", async (req) => {
        const user = requireUser(db, req);
        if (isFailure(user)) return user;
        const b = (req.body ?? {}) as { key?: string };
        try {
            const quota = await redeem(db, String(b.key ?? "").trim(), user.id);
            return ok({ quota });
        } catch (e) {
            if (e instanceof RedeemError) return fail(e.message);
            throw e;
        }
    });

    // 套餐列表是公开的
    app.post("/api/plan/list", async () =>
        ok({ records: listPlans(db).map(({ enabled, ...p }) => p) }),
    );
};
