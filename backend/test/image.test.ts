import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createFileStore } from "../src/cloud/files.js";
import { OpenAiImageProvider } from "../src/cloud/providers/openaiImage.js";
import { credit, getBalance } from "../src/wallet.js";
import { addModel, json, newUser, post, setup } from "./helpers.js";

test("同一个 clientId 重复提交不会重复扣费，并能续上同一个任务", async () => {
    const ctx = await setup();
    addModel(ctx);
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 1000, "topup");
    const body = { model: "CloudM1", version: "1.0", param: { async: true }, clientId: "task-42" };
    const a = await json(post(ctx, "/api/cloud/task/submit", body, u.token));
    const b = await json(post(ctx, "/api/cloud/task/submit", body, u.token));
    assert.equal(a.data.id, b.data.id);
    assert.equal(getBalance(ctx.db, u.id)!.quota, 900); // 只冻结一次
    ctx.mock.finish("mock-1", { url: "x" });
    const c = await json(post(ctx, "/api/cloud/task/submit", body, u.token));
    assert.equal(c.data.status, "succeeded");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 900);
    // 不同用户使用相同 clientId 互不影响
    const other = await newUser(ctx, "o@x.com");
    credit(ctx.db, other.id, 1000, "topup");
    const d = await json(post(ctx, "/api/cloud/task/submit", body, other.token));
    assert.notEqual(d.data.id, a.data.id);
});

const withUpstream = async (handler: (body: any, res: any) => void) => {
    const server = createServer((req, res) => {
        let raw = "";
        req.on("data", (c) => (raw += c));
        req.on("end", () => handler({ auth: req.headers.authorization, body: JSON.parse(raw || "{}") }, res));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { url: `http://127.0.0.1:${(server.address() as any).port}/v1`, close: () => server.close() };
};

test("图片供应商：上游返回 url 与 base64 两种情况，base64 落盘后可经 /files 下载", async () => {
    const ctx = await setup();
    let mode: "url" | "b64" | "empty" = "url";
    let seen: any;
    const up = await withUpstream((r, res) => {
        seen = r;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [mode === "url" ? { url: "https://cdn.example/a.png" } : mode === "b64" ? { b64_json: Buffer.from("PNGDATA").toString("base64") } : {}] }));
    });
    const store = createFileStore(ctx.filesDir, "http://localhost");
    const provider = new OpenAiImageProvider(store);
    const model: any = { providerConfig: { baseUrl: up.url, apiKey: "K", model: "img-1" } };

    const a: any = await provider.submit(model, { prompt: "一只猫", param: { width: 512, height: 768 } });
    assert.equal(a.result.url, "https://cdn.example/a.png");
    assert.equal(seen.auth, "Bearer K");
    assert.equal(seen.body.size, "512x768");

    mode = "b64";
    const b: any = await provider.submit(model, { prompt: "x" });
    assert.match(b.result.url, /^http:\/\/localhost\/files\/[a-f0-9]{32}\.png$/);
    const res = await ctx.app.inject({ method: "GET", url: new URL(b.result.url).pathname });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/png");
    assert.equal(res.body, "PNGDATA");

    mode = "empty";
    await assert.rejects(provider.submit(model, { prompt: "x" }), /没有返回图片/);
    await assert.rejects(provider.submit(model, { prompt: "  " }), /缺少提示词/);
    up.close();
});

test("/files 拒绝路径穿越与非法文件名", async () => {
    const ctx = await setup();
    for (const url of ["/files/..%2F..%2Fetc%2Fpasswd", "/files/abc.png", "/files/" + "a".repeat(32) + ".exe", "/files/" + "a".repeat(32) + ".png"]) {
        assert.equal((await ctx.app.inject({ method: "GET", url })).statusCode, 404, url);
    }
});
