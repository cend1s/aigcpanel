import assert from "node:assert/strict";
import { test } from "node:test";
import { activeSubscriptions, savePlan } from "../src/plans.js";
import { completeOrder, createOrder, OrderError } from "../src/pay/orders.js";
import { getBalance } from "../src/wallet.js";
import { json, makeAdmin, newUser, post, setup } from "./helpers.js";

const topup = async (ctx: any, token: string, amountCents = 1000, provider = "mock") =>
    (await json(post(ctx, "/api/pay/create", { kind: "topup", provider, amountCents }, token))).data;

const notify = (ctx: any, params: Record<string, string>, provider = "mock") =>
    ctx.app.inject({ method: "GET", url: `/api/pay/notify/${provider}?${new URLSearchParams(params)}` });

test("充值：回调入账一次；重复与并发回调不会重复入账", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    const order = await topup(ctx, u.token, 1000); // 10 元 = 10000 额度
    assert.match(order.payUrl, /\/pay\/mock\?trade_no=/);
    const params = ctx.mockPay.signedNotify(order.tradeNo, 1000);
    const results = await Promise.all([notify(ctx, params), notify(ctx, params), notify(ctx, params)]);
    assert.ok(results.every((r: any) => r.body === "success"));
    assert.equal(getBalance(ctx.db, u.id)!.quota, 10000);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) AS c FROM quota_ledger WHERE reason='topup'").get() as any).c, 1);
});

test("回调验签失败、金额不符、通道不符均不入账", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    const order = await topup(ctx, u.token, 1000);
    const forged = { ...ctx.mockPay.signedNotify(order.tradeNo, 1000), sign: "bad" };
    assert.equal((await notify(ctx, forged)).body, "fail");
    assert.equal((await notify(ctx, ctx.mockPay.signedNotify(order.tradeNo, 1))).body, "fail"); // 金额被篡改（签名有效但金额不符）
    assert.equal(getBalance(ctx.db, u.id)!.quota, 0);
    assert.throws(() => completeOrder(ctx.db, order.tradeNo, "epay", 1000), OrderError);
    assert.throws(() => completeOrder(ctx.db, "missing", "mock", 1000), OrderError);
    // 未支付状态的回调只确认收到，不入账
    assert.equal((await notify(ctx, ctx.mockPay.signedNotify(order.tradeNo, 1000, false))).body, "success");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 0);
});

test("充值金额范围校验；套餐金额以服务端价格为准", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    for (const amountCents of [0, 50, 99, 1_000_001, 12.5]) {
        assert.equal((await json(post(ctx, "/api/pay/create", { kind: "topup", provider: "mock", amountCents }, u.token))).code, -1);
    }
    const planId = savePlan(ctx.db, { title: "月卡", priceCents: 2990, durationDays: 30, quota: 5000, functions: { videoGen: true } });
    const r = await json(post(ctx, "/api/pay/create", { kind: "plan", provider: "mock", planId, amountCents: 1 }, u.token));
    assert.equal(r.data.moneyCents, 2990);
});

test("购买套餐：回调后开通订阅，user_info 下发功能权限，重复回调不重复开通", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    const planId = savePlan(ctx.db, { title: "月卡", priceCents: 2990, durationDays: 30, quota: 5000, functions: { videoGen: true } });
    const r = await json(post(ctx, "/api/pay/create", { kind: "plan", provider: "mock", planId }, u.token));
    const params = ctx.mockPay.signedNotify(r.data.tradeNo, 2990);
    await notify(ctx, params);
    await notify(ctx, params);
    assert.equal(activeSubscriptions(ctx.db, u.id).length, 1);
    const info = await json(post(ctx, "/api/app_manager/user_info", {}, u.token));
    assert.deepEqual(info.data.data.functions, { videoGen: true });
    // 续购顺延而不是叠加到同一时段
    const r2 = await json(post(ctx, "/api/pay/create", { kind: "plan", provider: "mock", planId }, u.token));
    await notify(ctx, ctx.mockPay.signedNotify(r2.data.tradeNo, 2990));
    const ends = ctx.db.prepare("SELECT start_time, end_time FROM subscriptions ORDER BY id").all() as any[];
    assert.equal(ends[1].start_time, ends[0].end_time);
});

test("易支付：签名生成与回调验签", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    const order = await topup(ctx, u.token, 500, "epay");
    const url = new URL(order.payUrl);
    assert.equal(url.pathname, "/submit.php");
    const p = Object.fromEntries(url.searchParams);
    assert.equal(p.money, "5.00");
    assert.equal(p.sign, ctx.epay.sign(p));
    // 通道回调：签名正确才入账
    const cb: Record<string, string> = { pid: "1001", out_trade_no: order.tradeNo, trade_status: "TRADE_SUCCESS", money: "5.00", type: "alipay", sign_type: "MD5" };
    assert.equal((await notify(ctx, { ...cb, sign: "0".repeat(32) }, "epay")).body, "fail");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 0);
    assert.equal((await notify(ctx, { ...cb, sign: ctx.epay.sign(cb) }, "epay")).body, "success");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 5000);
    // 表单 POST 回调同样可用
    const again = await ctx.app.inject({ method: "POST", url: "/api/pay/notify/epay", payload: new URLSearchParams({ ...cb, sign: ctx.epay.sign(cb) }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    assert.equal(again.body, "success");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 5000);
});

test("管理接口：非管理员 403；调额写流水与审计；补单幂等；禁用账号吊销 token", async () => {
    const ctx = await setup();
    const u = await newUser(ctx, "u@x.com");
    const admin = await makeAdmin(ctx);
    assert.equal((await post(ctx, "/api/admin/user/list", {}, u.token)).statusCode, 403);
    assert.equal((await post(ctx, "/api/admin/user/list")).statusCode, 403);

    assert.equal((await json(post(ctx, "/api/admin/user/adjust-quota", { userId: u.id, delta: 300 }, admin.token))).code, 0);
    assert.equal(getBalance(ctx.db, u.id)!.quota, 300);
    assert.notEqual((await json(post(ctx, "/api/admin/user/adjust-quota", { userId: u.id, delta: -999 }, admin.token))).code, 0);
    assert.equal(getBalance(ctx.db, u.id)!.quota, 300);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action='adjust_quota'").get() as any).c, 1);

    const order = await topup(ctx, u.token, 1000);
    for (let i = 0; i < 2; i++) await post(ctx, "/api/admin/order/complete", { tradeNo: order.tradeNo }, admin.token);
    assert.equal(getBalance(ctx.db, u.id)!.quota, 300 + 10000);

    await post(ctx, "/api/admin/user/set-status", { userId: u.id, status: 0 }, admin.token);
    assert.equal((await json(post(ctx, "/api/account/balance", {}, u.token))).code, 1001);
});

test("管理员批量生成兑换码，用户兑换入账；模型保存审计不含密钥", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    const admin = await makeAdmin(ctx);
    const created = await json(post(ctx, "/api/admin/redemption/create", { count: 2, quota: 200, batch: "b1" }, admin.token));
    assert.equal(created.data.keys.length, 2);
    assert.equal((await json(post(ctx, "/api/account/redeem", { key: created.data.keys[0] }, u.token))).data.quota, 200);
    assert.notEqual((await json(post(ctx, "/api/account/redeem", { key: created.data.keys[0] }, u.token))).code, 0);
    await post(ctx, "/api/admin/model/save", { name: "z", version: "1", title: "z", provider: "mock", pricing: { type: "per_call", amount: 1 }, providerConfig: { apiKey: "TOPSECRET" } }, admin.token);
    const logs = JSON.stringify(ctx.db.prepare("SELECT detail FROM audit_logs").all());
    assert.ok(!logs.includes("TOPSECRET"));
});

test("createOrder 固化 quota，之后改汇率不影响已建订单", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    const o = createOrder(ctx.db, { userId: u.id, kind: "topup", provider: "mock", method: "mock", amountCents: 100 });
    process.env.QUOTA_PER_YUAN = "1";
    completeOrder(ctx.db, o.tradeNo, "mock", 100);
    delete process.env.QUOTA_PER_YUAN;
    assert.equal(getBalance(ctx.db, u.id)!.quota, 1000);
});
