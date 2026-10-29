import assert from "node:assert/strict";
import { test } from "node:test";
import { LiveEngine, TalkItem } from "./engine.js";

// 虚拟时钟：sleep 推进时间并让出事件循环，测试不用真的等待
const harness = (opt: { synthMs?: number; playMs?: number; failSynth?: (text: string) => boolean; random?: number } = {}) => {
    let t = 1_000_000;
    const played: TalkItem[] = [];
    const released: string[] = [];
    const warns: string[] = [];
    const tick = () => new Promise<void>((r) => setImmediate(r));
    const engine = new LiveEngine({
        synthesize: async (text) => {
            t += opt.synthMs ?? 0;
            await tick();
            if (opt.failSynth?.(text)) throw new Error("tts down");
            return `/tmp/${text}.wav`;
        },
        play: async (item) => {
            played.push({ ...item });
            t += opt.playMs ?? 1000;
            await tick();
        },
        release: async (item) => void released.push(item.audio!),
        blackWords: () => ["全网最低", "最好"],
        now: () => t,
        sleep: async (ms) => {
            t += ms;
            await tick();
        },
        random: () => opt.random ?? 0,
        onWarn: (m) => warns.push(m),
    });
    const until = async (cond: () => boolean, max = 5000) => {
        for (let i = 0; i < max && !cond(); i++) await tick();
        assert.ok(cond(), "condition not reached");
    };
    return { engine, played, released, warns, until, now: () => t };
};

const kb = [
    { id: 1, title: "开场", content: { type: "flowTalk", enable: true, reply: "欢迎来到直播间", replies: [{ value: "全网最低价" }] } },
    { id: 2, title: "卖点", content: { type: "flowTalk", enable: true, reply: "保温十二小时" } },
    { id: 3, title: "停用", content: { type: "flowTalk", enable: false, reply: "不该播" } },
    { id: 4, title: "价格", content: { type: "user", enable: true, keywords: "多少钱", reply: "{username}，价格看一号链接" } },
    { id: 5, title: "欢迎", content: { type: "system", enable: true, systemType: "Enter", reply: "欢迎{username}" } },
    { id: 6, title: "点赞", content: { type: "system", enable: true, systemType: "Like", reply: "谢谢{username}的点赞" } },
];

test("循环口播按顺序轮播，跳过停用的知识和含违禁词的话术", async () => {
    const h = harness();
    h.engine.setKnowledge(kb);
    h.engine.start();
    await h.until(() => h.played.length >= 3);
    await h.engine.stop();
    assert.deepEqual(h.played.slice(0, 3).map((p) => p.text), ["欢迎来到直播间", "保温十二小时", "欢迎来到直播间"]);
    assert.ok(h.played.every((p) => p.source === "flowTalk"));
    // 播完的音频会被清理
    assert.ok(h.released.includes("/tmp/欢迎来到直播间.wav"));
});

test("两句循环口播之间留出设置的间隔", async () => {
    const h = harness({ playMs: 2000 });
    h.engine.setKnowledge(kb);
    h.engine.setConfig({ flowTalkDelayMin: 5, flowTalkDelayMax: 5 });
    const starts: number[] = [];
    const origPlay = (h.engine as any).deps.play;
    (h.engine as any).deps.play = async (item: TalkItem) => {
        starts.push(h.now());
        await origPlay(item);
    };
    h.engine.start();
    await h.until(() => starts.length >= 2);
    await h.engine.stop();
    // 第一句播 2 秒，再隔 5 秒，第二句开始（允许 sleep 粒度误差）
    assert.ok(starts[1] - starts[0] >= 7000 && starts[1] - starts[0] < 7300, String(starts[1] - starts[0]));
});

test("评论命中关键词时优先回复，昵称填进话术", async () => {
    const h = harness({ playMs: 3000 });
    h.engine.setKnowledge(kb);
    h.engine.start();
    await h.until(() => h.played.length >= 1);
    h.engine.onEvent({ type: "Comment", username: "小王", content: "这个多少钱" });
    h.engine.onEvent({ type: "Comment", username: "小李", content: "随便看看" });
    await h.until(() => h.played.length >= 2);
    await h.engine.stop();
    assert.equal(h.played[1].source, "user");
    assert.equal(h.played[1].text, "小王，价格看一号链接");
    assert.equal(h.played[1].trigger, "小王：这个多少钱");
});

test("优先级：弹幕回复 > 手动插播 > 系统事件 > 循环口播", async () => {
    const h = harness();
    h.engine.setKnowledge(kb.filter((k) => k.content.type !== "flowTalk"));
    h.engine.start();
    // 先占住播放，让后面的内容一起排队
    h.engine.say("第一句手动");
    await h.until(() => h.engine.current?.text === "第一句手动");
    h.engine.onEvent({ type: "Enter", username: "阿强" });
    h.engine.say("第二句手动");
    h.engine.onEvent({ type: "Comment", username: "小王", content: "多少钱" });
    await h.until(() => h.played.length >= 4);
    await h.engine.stop();
    assert.deepEqual(h.played.slice(1, 4).map((p) => p.source), ["user", "manual", "system"]);
});

test("同一观众短时间内重复进入只欢迎一次；点赞有全局冷却", async () => {
    const h = harness();
    h.engine.setKnowledge(kb.filter((k) => k.content.type !== "flowTalk"));
    h.engine.start();
    h.engine.onEvent({ type: "Enter", username: "阿强" });
    h.engine.onEvent({ type: "Like", username: "阿强" });
    await h.until(() => h.played.length >= 2);
    h.engine.onEvent({ type: "Enter", username: "阿强" });
    h.engine.onEvent({ type: "Like", username: "小红" });
    await new Promise((r) => setTimeout(r, 20));
    await h.engine.stop();
    assert.deepEqual(h.played.map((p) => p.text), ["欢迎阿强", "谢谢阿强的点赞"]);
});

test("手动插播含违禁词会被拦下；合成失败给出提示并继续", async () => {
    const h = harness({ failSynth: (t) => t === "合成会失败" });
    h.engine.setKnowledge([]);
    h.engine.start();
    assert.deepEqual(h.engine.say("这是最好的杯子"), { ok: false, reason: "blackWord", words: ["最好"] });
    h.engine.say("合成会失败");
    h.engine.say("正常的一句");
    await h.until(() => h.played.length >= 1);
    await h.engine.stop();
    assert.deepEqual(h.played.map((p) => p.text), ["正常的一句"]);
    assert.ok(h.warns.some((w) => w.includes("最好")));
    assert.ok(h.warns.some((w) => w.includes("语音合成失败")));
});

test("弹幕回复最多排 3 条，多出来时丢弃最早的", async () => {
    const h = harness({ playMs: 100_000 });
    h.engine.setKnowledge(kb.filter((k) => k.content.type === "user"));
    h.engine.start();
    h.engine.say("占住播放");
    await h.until(() => h.engine.current?.text === "占住播放");
    for (const name of ["a", "b", "c", "d", "e"]) {
        h.engine.onEvent({ type: "Comment", username: name, content: "多少钱" });
    }
    const waiting = h.engine.queue.filter((i) => i.source === "user").map((i) => i.text);
    await h.engine.stop();
    assert.deepEqual(waiting, ["c，价格看一号链接", "d，价格看一号链接", "e，价格看一号链接"]);
});

test("有循环口播在等待间隔时，新来的互动先播", async () => {
    const h = harness({ playMs: 1000 });
    h.engine.setKnowledge(kb);
    h.engine.setConfig({ flowTalkDelayMin: 30, flowTalkDelayMax: 30 });
    h.engine.start();
    await h.until(() => h.played.length >= 1);
    h.engine.onEvent({ type: "Comment", username: "小王", content: "多少钱" });
    await h.until(() => h.played.length >= 2);
    await h.engine.stop();
    assert.equal(h.played[0].source, "flowTalk");
    assert.equal(h.played[1].source, "user");
});
