import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { MockPayProvider } from "../pay/providers/mock.js";
import {
    completeOrder,
    createOrder,
    listOrders,
    MAX_TOPUP_CENTS,
    MIN_TOPUP_CENTS,
    OrderError,
    quotaPerYuan,
} from "../pay/orders.js";
import { fail, ok } from "../response.js";
import { isFailure, requireUser } from "../session.js";

export const payRoutes = (app: FastifyInstance, ctx: AppContext) => {
    const { db, payments, baseUrl } = ctx;

    app.post("/api/pay/methods", async () =>
        ok({
            providers: payments.list().map((p) => ({ name: p.name, methods: p.methods })),
            quotaPerYuan: quotaPerYuan(),
            minTopupCents: MIN_TOPUP_CENTS,
            maxTopupCents: MAX_TOPUP_CENTS,
        }),
    );

    app.post("/api/pay/create", async (req) => {
        const user = requireUser(db, req);
        if (isFailure(user)) return user;
        const b = (req.body ?? {}) as {
            kind?: string;
            provider?: string;
            method?: string;
            amountCents?: number;
            planId?: number;
        };
        const provider = payments.get(String(b.provider ?? ""));
        if (!provider) return fail("支付方式不可用");
        if (b.kind !== "topup" && b.kind !== "plan") return fail("订单类型无效");
        const method = provider.methods.find((m) => m.value === b.method)?.value ?? provider.methods[0].value;
        try {
            const order = createOrder(db, {
                userId: user.id,
                kind: b.kind,
                provider: provider.name,
                method,
                amountCents: b.amountCents,
                planId: b.planId,
            });
            return ok({
                tradeNo: order.tradeNo,
                moneyCents: order.moneyCents,
                payUrl: provider.createPayUrl({ ...order, method }, { baseUrl }),
            });
        } catch (e) {
            if (e instanceof OrderError) return fail(e.message);
            throw e;
        }
    });

    app.post("/api/pay/orders", async (req) => {
        const user = requireUser(db, req);
        if (isFailure(user)) return user;
        const b = (req.body ?? {}) as { page?: number; pageSize?: number };
        return ok({ records: listOrders(db, user.id, Number(b.page) || 1, Number(b.pageSize) || 20) });
    });

    // 支付回调：易支付等通道用 GET 或 POST，参数在 query 或 body
    const notify = async (req: any, reply: any) => {
        const provider = payments.get(String(req.params.provider));
        if (!provider) return reply.code(404).send("unknown provider");
        const params: Record<string, string> = {};
        for (const src of [req.query ?? {}, typeof req.body === "object" ? req.body ?? {} : {}]) {
            for (const [k, v] of Object.entries(src)) params[k] = String(v);
        }
        const result = provider.verifyNotify(params);
        if (!result) {
            req.log.warn({ provider: provider.name }, "pay notify: bad signature");
            return reply.type("text/plain").send(provider.ack.fail);
        }
        if (!result.paid) {
            return reply.type("text/plain").send(provider.ack.success); // 非成功状态：确认收到即可，不入账
        }
        try {
            completeOrder(db, result.tradeNo, provider.name, result.moneyCents);
            return reply.type("text/plain").send(provider.ack.success);
        } catch (e) {
            if (e instanceof OrderError) {
                req.log.warn({ tradeNo: result.tradeNo, err: e.message }, "pay notify rejected");
                return reply.type("text/plain").send(provider.ack.fail);
            }
            throw e;
        }
    };
    app.get("/api/pay/notify/:provider", notify);
    app.post("/api/pay/notify/:provider", notify);

    // 模拟支付页：仅当注册了 mock 通道（PAYMENT_MOCK=1）才可用
    const mock = payments.get("mock");
    if (mock instanceof MockPayProvider) {
        app.get("/pay/mock", async (req, reply) => {
            const tradeNo = String((req.query as any).trade_no ?? "");
            const order: any = db.prepare("SELECT * FROM orders WHERE trade_no = ? AND provider = 'mock'").get(tradeNo);
            if (!order) return reply.code(404).send("order not found");
            return reply.type("text/html").send(
                `<!doctype html><meta charset="utf-8"><title>模拟支付</title>
<body style="font:14px system-ui;padding:40px"><h2>模拟支付（仅开发环境）</h2>
<p>订单 ${order.trade_no.replace(/[^\w]/g, "")}，金额 ${(order.money_cents / 100).toFixed(2)} 元，状态 ${order.status}</p>
<button id="go">模拟支付成功</button>
<script>go.onclick=async()=>{await fetch('/pay/mock/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trade_no:'${order.trade_no.replace(/[^\w]/g, "")}'})});location.href='/app_manager/user';};</script>
</body>`,
            );
        });
        app.post("/pay/mock/confirm", async (req, reply) => {
            const tradeNo = String((req.body as any)?.trade_no ?? "");
            const order: any = db.prepare("SELECT * FROM orders WHERE trade_no = ? AND provider = 'mock'").get(tradeNo);
            if (!order) return reply.code(404).send("order not found");
            completeOrder(db, tradeNo, "mock", Number(order.money_cents));
            return ok({});
        });
    }
};
