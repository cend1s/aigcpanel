// 桌面端云端驱动（electron/aigcserver/cloud/runner.ts）与真实后端的契约测试：
// 用真实 HTTP 往返验证 提交 → 预扣 → 轮询 → 下载结果 → 结算，以及重试不重复扣费。
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { runCloudFunction, type CloudRunDeps } from "../../electron/aigcserver/cloud/runner.js";
import { createFileStore } from "../src/cloud/files.js";
import { saveModel } from "../src/cloud/models.js";
import { OpenAiImageProvider } from "../src/cloud/providers/openaiImage.js";
import { credit, getBalance } from "../src/wallet.js";
import { newUser, setup } from "./helpers.js";

test("驱动 ↔ 后端：文生图成功扣费，重试同一任务不重复扣费，失败退款", async () => {
    const ctx = await setup();
    const upstream = createServer((req, res) => {
        req.resume();
        req.on("end", () => {
            res.setHeader("content-type", "application/json");
            if (req.headers.authorization !== "Bearer GOOD") return res.writeHead(401).end();
            res.end(JSON.stringify({ data: [{ b64_json: Buffer.from("IMG-BYTES").toString("base64") }] }));
        });
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as any).port}/v1`;

    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${(ctx.app.server.address() as any).port}`;
    const files = createFileStore(ctx.filesDir, base);
    ctx.providers.register(new OpenAiImageProvider(files));
    saveModel(ctx.db, {
        name: "CloudImg",
        version: "1.0",
        title: "云端文生图",
        provider: "openai-image",
        pricing: { type: "per_call", amount: 30 },
        functions: { textToImage: { param: [] } },
        providerConfig: { baseUrl: upstreamUrl, apiKey: "GOOD", model: "img" },
    });

    const u = await newUser(ctx);
    credit(ctx.db, u.id, 100, "topup");
    const deps: CloudRunDeps = {
        post: async (url, data) =>
            (await fetch(`${base}/api/${url}`, { method: "POST", headers: { "content-type": "application/json", "api-token": u.token }, body: JSON.stringify(data) })).json() as any,
        download: async (url) => {
            const res = await fetch(url);
            assert.equal(res.status, 200);
            return `downloaded:${await res.text()}`;
        },
        readImageAsDataUrl: async () => "",
        sleep: async () => {},
        now: () => Date.now(),
        isCancelled: () => false,
    };
    const target = { name: "CloudImg", version: "1.0" };

    const a = await runCloudFunction(deps, target, "textToImage", { id: "task-1", prompt: "一只猫", param: { width: 512, height: 512 } });
    assert.equal(a.url, "downloaded:IMG-BYTES");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 70);

    // 桌面端重试同一个任务：返回已有结果，不再扣费
    const again = await runCloudFunction(deps, target, "textToImage", { id: "task-1", prompt: "一只猫" });
    assert.equal(again.url, "downloaded:IMG-BYTES");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 70);

    // 额度不足：带类型的错误
    credit(ctx.db, u.id, 0 + 1, "x");
    ctx.db.prepare("UPDATE users SET quota = 10 WHERE id = ?").run(u.id);
    await assert.rejects(runCloudFunction(deps, target, "textToImage", { id: "task-2", prompt: "x" }), (e: any) => e.type === "CreditNotEnough");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 10);

    // 上游报错（密钥无效）：任务失败，额度全额退回
    ctx.db.prepare("UPDATE users SET quota = 100 WHERE id = ?").run(u.id);
    ctx.db.prepare("UPDATE cloud_models SET provider_config = ? WHERE name = 'CloudImg'").run(JSON.stringify({ baseUrl: upstreamUrl, apiKey: "BAD", model: "img" }));
    await assert.rejects(runCloudFunction(deps, target, "textToImage", { id: "task-3", prompt: "x" }), (e: any) => e.type === "Failed");
    assert.equal(getBalance(ctx.db, u.id)!.quota, 100);

    await ctx.app.close();
    upstream.close();
});
