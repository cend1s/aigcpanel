import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createFileStore } from "../src/cloud/files.js";
import { estimateCost } from "../src/cloud/pricing.js";
import { OpenAiAsrProvider, OpenAiTtsProvider } from "../src/cloud/providers/openaiAudio.js";
import { credit, getBalance } from "../src/wallet.js";
import { addModel, json, newUser, post, setup } from "./helpers.js";

type Seen = { url?: string; auth?: string; type?: string; raw: Buffer };

const withUpstream = async (handler: (seen: Seen, res: any) => void) => {
    const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () =>
            handler({ url: req.url, auth: req.headers.authorization, type: req.headers["content-type"], raw: Buffer.concat(chunks) }, res),
        );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { url: `http://127.0.0.1:${(server.address() as any).port}/v1`, close: () => server.close() };
};

const wavDataUrl = `data:audio/wav;base64,${Buffer.from("RIFFxxxxWAVE").toString("base64")}`;

test("语音识别供应商：multipart 上传音频，分段时间换算成毫秒，用量按秒或分钟", async () => {
    let seen!: Seen;
    let body: any = {
        duration: 75.2,
        segments: [
            { start: 0, end: 1.5, text: " 大家好 " },
            { start: 1.5, end: 3.25, text: "欢迎来到直播间" },
            { start: 3.25, end: 4, text: "  " },
        ],
    };
    const up = await withUpstream((s, res) => {
        seen = s;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(body));
    });
    const provider = new OpenAiAsrProvider();
    const model: any = { providerConfig: { baseUrl: up.url, apiKey: "K", model: "whisper-1", language: "zh" }, pricing: { type: "per_unit", unit: "second", amount: 1 } };

    const a: any = await provider.submit(model, { type: "asr", audio: wavDataUrl });
    assert.equal(seen.url, "/v1/audio/transcriptions");
    assert.equal(seen.auth, "Bearer K");
    assert.match(seen.type!, /^multipart\/form-data/);
    const raw = seen.raw.toString("latin1");
    assert.match(raw, /name="file"; filename="audio\.wav"/);
    assert.match(raw, /RIFFxxxxWAVE/);
    assert.match(raw, /name="response_format"\r\n\r\nverbose_json/);
    assert.match(raw, /name="language"\r\n\r\nzh/);
    assert.deepEqual(a.result.records, [
        { start: 0, end: 1500, text: "大家好" },
        { start: 1500, end: 3250, text: "欢迎来到直播间" },
    ]);
    assert.equal(a.usage.units, 76);

    // 按分钟计价；上游只给整段文字时作为一条记录
    model.pricing = { type: "per_unit", unit: "minute", amount: 10 };
    body = { text: "整段文字", duration: 75.2 };
    const b: any = await provider.submit(model, { audio: wavDataUrl });
    assert.deepEqual(b.result.records, [{ start: 0, end: 75200, text: "整段文字" }]);
    assert.equal(b.usage.units, 2);

    body = { text: "" };
    await assert.rejects(provider.submit(model, { audio: wavDataUrl }), /没有返回识别结果/);
    await assert.rejects(provider.submit(model, { audio: "/local/a.wav" }), /缺少音频文件/);
    await assert.rejects(provider.submit(model, { audio: "data:text/plain;base64,eA==" }), /不支持的音频格式/);
    up.close();
});

test("语音合成供应商：音色与语速透传，音频落盘后经 /files 下载，用量按字数", async () => {
    const ctx = await setup();
    let seen!: Seen;
    let audio = Buffer.from("ID3-MP3DATA");
    const up = await withUpstream((s, res) => {
        seen = s;
        res.setHeader("content-type", "audio/mpeg");
        res.end(audio);
    });
    const provider = new OpenAiTtsProvider(createFileStore(ctx.filesDir, "http://localhost"));
    const model: any = { providerConfig: { baseUrl: up.url, apiKey: "K", model: "tts-1", voice: "alloy" } };

    const a: any = await provider.submit(model, { type: "soundTts", text: "你好世界", param: { speaker: "nova", speed: 1.2 } });
    assert.equal(seen.url, "/v1/audio/speech");
    assert.deepEqual(JSON.parse(seen.raw.toString()), { model: "tts-1", input: "你好世界", voice: "nova", response_format: "mp3", speed: 1.2 });
    assert.equal(a.usage.units, 4);
    assert.match(a.result.url, /^http:\/\/localhost\/files\/[a-f0-9]{32}\.mp3$/);
    const res = await ctx.app.inject({ method: "GET", url: new URL(a.result.url).pathname });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "audio/mpeg");
    assert.equal(res.body, "ID3-MP3DATA");

    // 客户端没选音色时用配置里的默认音色
    await provider.submit(model, { text: "x" });
    assert.equal(JSON.parse(seen.raw.toString()).voice, "alloy");

    audio = Buffer.alloc(0);
    await assert.rejects(provider.submit(model, { text: "x" }), /没有返回音频/);
    await assert.rejects(provider.submit(model, { text: " " }), /缺少要合成的文本/);
    up.close();
});

test("按字 / 按分钟计价的预估数量", () => {
    assert.equal(estimateCost({ type: "per_unit", unit: "char", amount: 2 }, { text: "一二三四五" }), 10);
    assert.equal(estimateCost({ type: "per_unit", unit: "minute", amount: 10 }, { duration: 61 }), 20);
    assert.equal(estimateCost({ type: "per_unit", unit: "second", amount: 1 }, { duration: 30 }), 30);
    assert.equal(estimateCost({ type: "per_unit", unit: "char", amount: 2 }, {}), 2);
});

test("按字计价的语音合成任务：先按文本长度预扣，成功后按实际用量结算", async () => {
    const ctx = await setup();
    addModel(ctx, { type: "per_unit", unit: "char", amount: 3 }, "CloudTts");
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 100, "topup");
    const r = await json(
        post(ctx, "/api/cloud/task/submit", { model: "CloudTts", version: "1.0", param: { type: "soundTts", text: "你好", usage: { units: 2 } } }, u.token),
    );
    assert.equal(r.data.status, "succeeded");
    assert.equal(r.data.cost, 6);
    assert.equal(getBalance(ctx.db, u.id)!.quota, 94);
});
