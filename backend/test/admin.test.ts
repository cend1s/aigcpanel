import assert from "node:assert/strict";
import { test } from "node:test";
import { maskConfig, mergeSecrets } from "../src/routes/admin.js";
import { credit } from "../src/wallet.js";
import { json, makeAdmin, newUser, post, setup } from "./helpers.js";

test("admin/me：管理员返回身份，普通用户 403", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    const a = await makeAdmin(ctx);
    assert.equal((await post(ctx, "/api/admin/me", {}, u.token)).statusCode, 403);
    assert.equal((await json(post(ctx, "/api/admin/me", {}, a.token))).data.email, "admin@x.com");
});

test("列表带 total 并分页、可搜索", async () => {
    const ctx = await setup();
    const a = await makeAdmin(ctx);
    for (let i = 0; i < 5; i++) await newUser(ctx, `u${i}@x.com`);
    const p1 = await json(post(ctx, "/api/admin/user/list", { page: 1, pageSize: 2 }, a.token));
    assert.equal(p1.data.total, 6);
    assert.equal(p1.data.records.length, 2);
    const p3 = await json(post(ctx, "/api/admin/user/list", { page: 3, pageSize: 2 }, a.token));
    assert.equal(p3.data.records.length, 2);
    const s = await json(post(ctx, "/api/admin/user/list", { keyword: "u3@" }, a.token));
    assert.deepEqual(s.data.records.map((r: any) => r.email), ["u3@x.com"]);
    // LIKE 通配符按字面量匹配，不能用 % 或 _ 匹配全部
    assert.equal((await json(post(ctx, "/api/admin/user/list", { keyword: "%" }, a.token))).data.total, 0);
    assert.equal((await json(post(ctx, "/api/admin/user/list", { keyword: "u_@" }, a.token))).data.total, 0);
});

test("模型：列表与详情脱敏密钥；保存时未改动的密钥保留原值，改动则更新", async () => {
    const ctx = await setup();
    const a = await makeAdmin(ctx);
    const base = { name: "CloudImg", version: "1.0", title: "图", provider: "mock", pricing: { type: "per_call", amount: 10 } };
    await post(ctx, "/api/admin/model/save", { ...base, providerConfig: { baseUrl: "https://u", apiKey: "sk-ABCDEFG1234" } }, a.token);
    const list = await json(post(ctx, "/api/admin/model/list", {}, a.token));
    const m = list.data.records[0];
    assert.equal(m.providerConfig.apiKey, "******1234");
    assert.equal(m.providerConfig.baseUrl, "https://u");
    assert.ok(!JSON.stringify(list).includes("ABCDEFG"));
    // 回传脱敏值（用户没改密钥）→ 原值保留
    await post(ctx, "/api/admin/model/save", { ...base, title: "图2", providerConfig: m.providerConfig }, a.token);
    const raw: any = ctx.db.prepare("SELECT provider_config, title FROM cloud_models").get();
    assert.equal(JSON.parse(raw.provider_config).apiKey, "sk-ABCDEFG1234");
    assert.equal(raw.title, "图2");
    // 填了新密钥 → 更新
    await post(ctx, "/api/admin/model/save", { ...base, providerConfig: { baseUrl: "https://u", apiKey: "sk-NEW9999" } }, a.token);
    assert.equal(JSON.parse((ctx.db.prepare("SELECT provider_config FROM cloud_models").get() as any).provider_config).apiKey, "sk-NEW9999");
    // 未注册的供应商被拒绝
    assert.notEqual((await json(post(ctx, "/api/admin/model/save", { ...base, provider: "nope" }, a.token))).code, 0);
    assert.deepEqual((await json(post(ctx, "/api/admin/model/providers", {}, a.token))).data.records, ["mock"]);
});

test("mask/merge 只处理密钥类字段", () => {
    assert.deepEqual(maskConfig({ apiKey: "abcdef", secretKey: "xyz9", model: "m", empty: "" }), { apiKey: "******cdef", secretKey: "******xyz9", model: "m", empty: "" });
    assert.deepEqual(mergeSecrets({ apiKey: "", token: "******1", model: "n" }, { apiKey: "K", token: "T", model: "o" }), { apiKey: "K", token: "T", model: "n" });
});

test("统计、审计、用户流水、不能禁用自己、套餐参数校验", async () => {
    const ctx = await setup();
    const a = await makeAdmin(ctx);
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 100, "topup");
    await post(ctx, "/api/admin/user/adjust-quota", { userId: u.id, delta: 50, remark: "补偿" }, a.token);
    const stats = await json(post(ctx, "/api/admin/stats", {}, a.token));
    assert.equal(stats.data.users, 2);
    const audit = await json(post(ctx, "/api/admin/audit/list", {}, a.token));
    assert.equal(audit.data.records[0].action, "adjust_quota");
    assert.equal(audit.data.records[0].actor, "admin@x.com");
    const ledger = await json(post(ctx, "/api/admin/user/ledger", { userId: u.id }, a.token));
    assert.deepEqual(ledger.data.records.map((r: any) => r.delta), [50, 100]);
    assert.notEqual((await json(post(ctx, "/api/admin/user/set-status", { userId: a.id, status: 0 }, a.token))).code, 0);
    assert.notEqual((await json(post(ctx, "/api/admin/plan/save", { title: "x", priceCents: 100, durationDays: 0, quota: 1 }, a.token))).code, 0);
    const saved = await json(post(ctx, "/api/admin/plan/save", { title: "月卡", priceCents: 990, durationDays: 30, quota: 1000, functions: { a: true } }, a.token));
    assert.equal((await json(post(ctx, "/api/admin/plan/get", { id: saved.data.id }, a.token))).data.title, "月卡");
    assert.equal((await json(post(ctx, "/api/admin/plan/list", {}, a.token))).data.total, 1);
});

test("管理后台静态托管：页面与前端路由回退，资源缺失返回 404，不能穿越目录", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "admin-"));
    writeFileSync(join(dir, "index.html"), "<html>ADMIN</html>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
    const { buildApp } = await import("../src/app.js");
    const ctx = await setup();
    const app = buildApp({ db: ctx.db, providers: ctx.providers, payments: new (await import("../src/pay/types.js")).PaymentRegistry(), baseUrl: "http://x", filesDir: ctx.filesDir, adminDir: dir });
    await app.ready();
    const get = (url: string) => app.inject({ method: "GET", url });
    assert.match((await get("/admin/")).body, /ADMIN/);
    assert.match((await get("/admin/users/123")).body, /ADMIN/); // 前端路由
    assert.equal((await get("/admin/assets/app.js")).statusCode, 200);
    assert.equal((await get("/admin/assets/missing.js")).statusCode, 404);
    assert.equal((await get("/admin/..%2f..%2fetc%2fpasswd")).body.includes("root:"), false);
    assert.equal((await get("/nope")).statusCode, 404);
    // 相对路径也能工作（默认配置是 ../admin/dist）
    const { relative } = await import("node:path");
    const app2 = buildApp({ db: ctx.db, providers: ctx.providers, payments: new (await import("../src/pay/types.js")).PaymentRegistry(), baseUrl: "http://x", filesDir: ctx.filesDir, adminDir: relative(process.cwd(), dir) });
    await app2.ready();
    assert.match((await app2.inject({ method: "GET", url: "/admin/" })).body, /ADMIN/);
});
