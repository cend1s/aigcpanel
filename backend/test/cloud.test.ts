import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { OpenAiChatProvider } from "../src/cloud/providers/openaiChat.js";
import { estimateCost, parsePricing } from "../src/cloud/pricing.js";
import { saveModel } from "../src/cloud/models.js";
import { sweepTasks } from "../src/cloud/tasks.js";
import { activatePlan, savePlan } from "../src/plans.js";
import { credit, getBalance } from "../src/wallet.js";
import { addModel, json, newUser, post, setup } from "./helpers.js";

const sum = (db: any, id: number) =>
    (db.prepare("SELECT COALESCE(SUM(delta),0) AS s FROM quota_ledger WHERE user_id = ?").get(id) as any).s;

test("server/all 不下发供应商配置与价格，密钥不出后端", async () => {
    const ctx = await setup();
    addModel(ctx);
    const res = await json(post(ctx, "/api/server/all"));
    assert.equal(res.data.records.length, 1);
    const text = JSON.stringify(res);
    assert.ok(!text.includes("SECRET-KEY"));
    assert.ok(!text.includes("provider"));
    assert.ok(!text.includes("pricing"));
});

test("task/check：未登录 1001；额度不足返回 CreditNotEnough；充值后通过", async () => {
    const ctx = await setup();
    addModel(ctx);
    const u = await newUser(ctx);
    assert.equal((await json(post(ctx, "/api/aigcpanel/task/check", { model: "m1", version: "1.0" }))).code, 1001);
    const low = await json(post(ctx, "/api/aigcpanel/task/check", { model: "m1", version: "1.0" }, u.token));
    assert.equal(low.data.type, "CreditNotEnough");
    credit(ctx.db, u.id, 100, "topup");
    assert.equal((await json(post(ctx, "/api/aigcpanel/task/check", { model: "m1", version: "1.0" }, u.token))).code, 0);
});

test("同步任务成功：按次扣费并写流水", async () => {
    const ctx = await setup();
    addModel(ctx);
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 1000, "topup");
    const r = await json(post(ctx, "/api/cloud/task/submit", { model: "m1", version: "1.0", param: { prompt: "hi" } }, u.token));
    assert.equal(r.data.status, "succeeded");
    assert.equal(r.data.cost, 100);
    assert.deepEqual(getBalance(ctx.db, u.id), { quota: 900, usedQuota: 100 });
    assert.equal(sum(ctx.db, u.id), 900);
});

test("额度不足时拒绝提交，且不会冻结任何额度", async () => {
    const ctx = await setup();
    addModel(ctx);
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 50, "topup");
    const r = await json(post(ctx, "/api/cloud/task/submit", { model: "m1", version: "1.0" }, u.token));
    assert.equal(r.data.type, "CreditNotEnough");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 50);
});

test("上游失败：全额退回", async () => {
    const ctx = await setup();
    addModel(ctx);
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 1000, "topup");
    const r = await json(post(ctx, "/api/cloud/task/submit", { model: "m1", version: "1.0", param: { fail: true } }, u.token));
    assert.equal(r.data.status, "failed");
    assert.deepEqual(getBalance(ctx.db, u.id), { quota: 1000, usedQuota: 0 });
    assert.equal(sum(ctx.db, u.id), 1000);
});

test("按 token 计费：实际用量小于预估时多退", async () => {
    const ctx = await setup();
    addModel(ctx, { type: "per_token", inputPer1k: 10, outputPer1k: 30 });
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 10000, "topup");
    const r = await json(
        post(ctx, "/api/cloud/task/submit", { model: "m1", version: "1.0", param: { prompt: "hi", usage: { inputTokens: 1000, outputTokens: 1000 } } }, u.token),
    );
    assert.equal(r.data.status, "succeeded");
    assert.equal(r.data.cost, 40); // 1k*10 + 1k*30
    assert.equal(getBalance(ctx.db, u.id)!.quota, 10000 - 40);
});

test("异步任务：查询推进到成功后结算，重复查询不会重复扣费", async () => {
    const ctx = await setup();
    addModel(ctx);
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 1000, "topup");
    const s = await json(post(ctx, "/api/cloud/task/submit", { model: "m1", version: "1.0", param: { async: true } }, u.token));
    assert.equal(s.data.status, "running");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 900); // 已冻结
    let st = await json(post(ctx, "/api/cloud/task/status", { id: s.data.id }, u.token));
    assert.equal(st.data.status, "running");
    ctx.mock.finish("mock-1", { url: "x.mp4" });
    for (let i = 0; i < 3; i++) {
        st = await json(post(ctx, "/api/cloud/task/status", { id: s.data.id }, u.token));
        assert.equal(st.data.status, "succeeded");
    }
    assert.equal(getBalance(ctx.db, u.id)!.quota, 900);
    assert.equal(sum(ctx.db, u.id), 900);
});

test("不能查询别人的任务", async () => {
    const ctx = await setup();
    addModel(ctx);
    const a = await newUser(ctx, "a@x.com");
    const b = await newUser(ctx, "b@x.com");
    credit(ctx.db, a.id, 1000, "topup");
    const s = await json(post(ctx, "/api/cloud/task/submit", { model: "m1", version: "1.0", param: { async: true } }, a.token));
    const r = await json(post(ctx, "/api/cloud/task/status", { id: s.data.id }, b.token));
    assert.equal(r.data.type, "TaskNotFound");
});

test("订阅额度优先扣，不足部分回落钱包；失败时按来源各自退回", async () => {
    const ctx = await setup();
    addModel(ctx);
    const u = await newUser(ctx);
    const planId = savePlan(ctx.db, { title: "月卡", priceCents: 1000, durationDays: 30, quota: 60 });
    activatePlan(ctx.db, u.id, planId);
    credit(ctx.db, u.id, 500, "topup");
    const r = await json(post(ctx, "/api/cloud/task/submit", { model: "m1", version: "1.0", param: { async: true } }, u.token));
    // 预估 100：订阅 60 + 钱包 40
    assert.equal(getBalance(ctx.db, u.id)!.quota, 460);
    assert.equal((ctx.db.prepare("SELECT quota_used FROM subscriptions").get() as any).quota_used, 60);
    ctx.mock.failJob("mock-1");
    await json(post(ctx, "/api/cloud/task/status", { id: r.data.id }, u.token));
    assert.equal(getBalance(ctx.db, u.id)!.quota, 500);
    assert.equal((ctx.db.prepare("SELECT quota_used FROM subscriptions").get() as any).quota_used, 0);
});

test("兜底扫描：提交中断的任务退款，超时的运行任务退款", async () => {
    const ctx = await setup();
    addModel(ctx);
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 1000, "topup");
    const a = await json(post(ctx, "/api/cloud/task/submit", { model: "m1", version: "1.0", param: { async: true } }, u.token));
    // 模拟：另一个任务停在 reserved（进程在调用上游前崩溃）
    ctx.db.prepare("UPDATE cloud_tasks SET status = 'reserved', updated_at = 1, created_at = 1 WHERE id = ?").run(a.data.id);
    const b = await json(post(ctx, "/api/cloud/task/submit", { model: "m1", version: "1.0", param: { async: true } }, u.token));
    ctx.db.prepare("UPDATE cloud_tasks SET updated_at = 1, created_at = 1 WHERE id = ?").run(b.data.id);
    assert.equal(getBalance(ctx.db, u.id)!.quota, 800);
    assert.equal(await sweepTasks(ctx.db, ctx.providers), 2);
    assert.deepEqual(getBalance(ctx.db, u.id), { quota: 1000, usedQuota: 0 });
    assert.equal(await sweepTasks(ctx.db, ctx.providers), 0); // 再扫一次无副作用
});

test("价格规则校验与预估", () => {
    assert.throws(() => parsePricing({ type: "per_call", amount: -1 }));
    assert.throws(() => parsePricing({ type: "nope" }));
    assert.equal(estimateCost(parsePricing({ type: "per_unit", unit: "second", amount: 5 }), { units: 10 }), 50);
});

test("OpenAI 兼容供应商：解析回复与用量，上游报错时抛出", async () => {
    const server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
            if (req.headers.authorization !== "Bearer K") {
                res.writeHead(401).end();
                return;
            }
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ choices: [{ message: { content: `re:${JSON.parse(body).model}` } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
        });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    const provider = new OpenAiChatProvider();
    const model: any = { providerConfig: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "K", model: "gpt-x" } };
    const ok: any = await provider.submit(model, { prompt: "hi" });
    assert.deepEqual([ok.result.text, ok.usage], ["re:gpt-x", { inputTokens: 7, outputTokens: 3 }]);
    model.providerConfig.apiKey = "bad";
    await assert.rejects(provider.submit(model, { prompt: "hi" }));
    server.close();
});

test("管理后台保存模型时拒绝非法价格", async () => {
    const ctx = await setup();
    assert.throws(() => saveModel(ctx.db, { name: "a", version: "1", title: "a", provider: "mock", pricing: { type: "per_call", amount: -5 } }));
});
