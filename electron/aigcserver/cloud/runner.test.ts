import assert from "node:assert/strict";
import { test } from "node:test";
import { CloudRunDeps, CloudRunError, runCloudFunction } from "./runner.js";

const target = { name: "CloudImg", version: "1.0" };

const make = (script: any[], over: Partial<CloudRunDeps> = {}) => {
    const calls: { url: string; data: any }[] = [];
    let i = 0;
    let t = 0;
    const deps: CloudRunDeps = {
        post: async (url, data) => {
            calls.push({ url, data });
            return script[Math.min(i++, script.length - 1)];
        },
        download: async (u) => `/tmp/${u.split("/").pop()}`,
        readImageAsDataUrl: async (p) => `data:image/png;base64,FROM:${p}`,
        sleep: async (ms) => void (t += ms),
        now: () => t,
        isCancelled: () => false,
        ...over,
    };
    return { deps, calls };
};

const ok = (data: any) => ({ code: 0, msg: "ok", data });

test("提交后轮询直到成功，下载结果并返回本地路径；以任务 id 作为 clientId", async () => {
    const { deps, calls } = make([
        ok({ id: "c1", status: "running" }),
        ok({ id: "c1", status: "running" }),
        ok({ id: "c1", status: "succeeded", result: { url: "https://cdn/x/out.png" } }),
    ]);
    const r = await runCloudFunction(deps, target, "textToImage", { id: "task-7", prompt: "猫", param: { width: 512 } });
    assert.deepEqual(r, { url: "/tmp/out.png" });
    assert.equal(calls[0].url, "cloud/task/submit");
    assert.equal(calls[0].data.clientId, "task-7");
    assert.deepEqual(calls[0].data.param, { type: "textToImage", prompt: "猫", param: { width: 512 } });
    assert.deepEqual(calls.slice(1).map((c) => c.url), ["cloud/task/status", "cloud/task/status"]);
});

test("同步完成的任务不需要轮询", async () => {
    const { deps, calls } = make([ok({ id: "c1", status: "succeeded", result: { url: "https://cdn/a.png" } })]);
    await runCloudFunction(deps, target, "textToImage", { id: "t", prompt: "x" });
    assert.equal(calls.length, 1);
});

test("图生图：本地图片转 data URL，远程地址原样传递", async () => {
    const done = ok({ id: "c", status: "succeeded", result: { url: "https://cdn/a.png" } });
    const a = make([done]);
    await runCloudFunction(a.deps, target, "imageToImage", { id: "t", prompt: "x", image: "/home/u/a.png" });
    assert.equal(a.calls[0].data.param.image, "data:image/png;base64,FROM:/home/u/a.png");
    const b = make([done]);
    await runCloudFunction(b.deps, target, "imageToImage", { id: "t", prompt: "x", image: "https://x/y.png" });
    assert.equal(b.calls[0].data.param.image, "https://x/y.png");
});

test("失败、未登录、额度不足、空结果都以带类型的错误抛出", async () => {
    const run = (script: any[]) => runCloudFunction(make(script).deps, target, "textToImage", { id: "t", prompt: "x" });
    await assert.rejects(run([ok({ id: "c", status: "failed", error: "上游挂了" })]), (e: any) => e instanceof CloudRunError && e.type === "Failed" && /上游挂了/.test(e.message));
    await assert.rejects(run([{ code: 1001, msg: "请先登录", data: {} }]), (e: any) => e.type === "LoginRequired");
    await assert.rejects(run([{ code: -1, msg: "额度不足，请先充值", data: { type: "CreditNotEnough" } }]), (e: any) => e.type === "CreditNotEnough" && /额度不足/.test(e.message));
    await assert.rejects(run([ok({ id: "c", status: "succeeded", result: {} })]), (e: any) => e.type === "EmptyResult");
});

test("超时与取消", async () => {
    const running = ok({ id: "c", status: "running" });
    await assert.rejects(
        runCloudFunction(make([running]).deps, target, "textToVideo", { id: "t", prompt: "x" }, { pollInterval: 1000, timeout: 5000 }),
        (e: any) => e.type === "Timeout",
    );
    let n = 0;
    const m = make([running], { isCancelled: () => ++n > 2 });
    await assert.rejects(runCloudFunction(m.deps, target, "textToVideo", { id: "t", prompt: "x" }), (e: any) => e.type === "Cancelled");
});

test("语音合成：文本随任务提交，结果音频下载到本地", async () => {
    const { deps, calls } = make([ok({ id: "c", status: "succeeded", result: { url: "https://srv/files/a.mp3" } })]);
    const r = await runCloudFunction(deps, target, "soundTts", { id: "t", text: "你好", param: { speaker: "nova" } });
    assert.deepEqual(r, { url: "/tmp/a.mp3" });
    assert.deepEqual(calls[0].data.param, { type: "soundTts", prompt: "", param: { speaker: "nova" }, text: "你好" });
});

test("语音识别：本地音频转 data URL 上传，返回识别记录而不是文件", async () => {
    const records = [{ start: 0, end: 1500, text: "大家好" }];
    const { deps, calls } = make([ok({ id: "c", status: "succeeded", result: { records } })], {
        readAudioAsDataUrl: async (p) => `data:audio/mpeg;base64,FROM:${p}`,
    });
    const r = await runCloudFunction(deps, target, "asr", { id: "t", audio: "/home/u/a.wav" });
    assert.deepEqual(r, { records });
    assert.equal(calls[0].data.param.audio, "data:audio/mpeg;base64,FROM:/home/u/a.wav");
    await assert.rejects(
        runCloudFunction(make([ok({ id: "c", status: "succeeded", result: {} })]).deps, target, "asr", { id: "t", audio: "https://x/a.mp3" }),
        (e: any) => e.type === "EmptyResult",
    );
});
