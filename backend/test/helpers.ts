import { MockProvider } from "../src/cloud/providers/mock.js";
import { ProviderRegistry } from "../src/cloud/types.js";
import { saveModel } from "../src/cloud/models.js";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { EpayProvider } from "../src/pay/providers/epay.js";
import { MockPayProvider } from "../src/pay/providers/mock.js";
import { PaymentRegistry } from "../src/pay/types.js";
import { ROLE_ADMIN } from "../src/users.js";

process.env.NODE_ENV = "test";

export const setup = async () => {
    const db = openDb(":memory:");
    const mock = new MockProvider();
    const providers = new ProviderRegistry().register(mock);
    const mockPay = new MockPayProvider();
    const epay = new EpayProvider({ gateway: "https://pay.example.com", pid: "1001", key: "secret" });
    const payments = new PaymentRegistry().register(mockPay).register(epay);
    const app = buildApp({ db, providers, payments, baseUrl: "http://localhost" });
    await app.ready();
    return { app, db, mock, mockPay, epay, providers };
};

export type Ctx = Awaited<ReturnType<typeof setup>>;

export const post = (ctx: Ctx, url: string, body: object = {}, token?: string) =>
    ctx.app.inject({ method: "POST", url, payload: body, headers: token ? { "api-token": token } : {} });

export const json = async (p: ReturnType<typeof post>) => (await p).json();

export const newUser = async (ctx: Ctx, email = "u@x.com") => {
    const r = (await post(ctx, "/api/auth/register", { email, password: "password1" })).json();
    return { id: Number(r.data.user.id), token: r.data.apiToken as string };
};

export const makeAdmin = async (ctx: Ctx, email = "admin@x.com") => {
    const u = await newUser(ctx, email);
    ctx.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(ROLE_ADMIN, u.id);
    return u;
};

export const addModel = (ctx: Ctx, pricing: unknown = { type: "per_call", amount: 100 }, name = "m1") =>
    saveModel(ctx.db, {
        name,
        version: "1.0",
        title: name,
        provider: "mock",
        pricing,
        functions: { textGen: { param: [] } },
        providerConfig: { apiKey: "SECRET-KEY" },
    });
