import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { maxUniqueCombos, planVariants, type MatrixInput } from "./plan.js";
import { buildRenderArgs, buildSrt, planSegments, splitSubtitleLines } from "./render.js";

const base: MatrixInput = { clipCount: 4, scriptCount: 2, voiceCount: 2, count: 10, seed: 42, options: { clipsPerVideo: 3, jitter: true, mirror: true } };

test("规划：同一 seed 结果一致；组合不重复；文案与音色分配均匀；参数在范围内", () => {
    const a = planVariants(base);
    const b = planVariants(base);
    assert.deepEqual(a, b);
    assert.equal(a.variants.length, 10);
    const keys = a.variants.map((v) => `${v.scriptIndex}|${v.voiceIndex}|${v.clipOrder}`);
    assert.equal(new Set(keys).size, keys.length);
    const pairCount = new Map<string, number>();
    for (const v of a.variants) pairCount.set(`${v.scriptIndex}-${v.voiceIndex}`, (pairCount.get(`${v.scriptIndex}-${v.voiceIndex}`) ?? 0) + 1);
    assert.deepEqual([...pairCount.values()].sort(), [2, 2, 3, 3]);
    for (const v of a.variants) {
        assert.equal(new Set(v.clipOrder).size, 3);
        assert.ok(v.speed >= 0.95 && v.speed <= 1.05 && v.zoom >= 1 && v.zoom <= 1.08);
    }
    assert.notDeepEqual(planVariants({ ...base, seed: 7 }).variants, a.variants);
});

test("规划：不重复组合不够时如实返回较少数量并标记 exhausted", () => {
    const small = { ...base, clipCount: 2, scriptCount: 1, voiceCount: 1, count: 5, options: { clipsPerVideo: 2, jitter: false, mirror: false } };
    assert.equal(maxUniqueCombos(small), 2);
    const r = planVariants(small);
    assert.equal(r.variants.length, 2);
    assert.equal(r.exhausted, true);
    assert.ok(r.variants.every((v) => v.speed === 1 && v.zoom === 1 && !v.mirror));
});

test("规划：参数校验", () => {
    assert.throws(() => planVariants({ ...base, clipCount: 0 }), /素材/);
    assert.throws(() => planVariants({ ...base, count: 201 }), /生成数量/);
    assert.throws(() => planVariants({ ...base, options: { ...base.options, clipsPerVideo: 0 } }), /素材数/);
});

test("片段切分：总时长覆盖配音；起点在素材范围内；素材太短时循环使用", () => {
    const clips = [{ path: "a", duration: 3 }, { path: "b", duration: 10 }, { path: "c", duration: 1.2 }];
    const v = planVariants({ ...base, clipCount: 3, count: 1 }).variants[0];
    for (const audio of [2, 7.5, 30]) {
        const segs = planSegments(clips, v, audio);
        const total = segs.reduce((s, x) => s + x.outLength, 0);
        assert.ok(Math.abs(total - audio) < 0.02, `audio=${audio} total=${total}`);
        for (const s of segs) {
            assert.ok(s.start >= 0 && s.start + s.inLength <= clips[s.clip].duration + 0.001);
        }
    }
    assert.throws(() => planSegments(clips, v, 0));
});

test("字幕：按标点断句、过长再切；时间连续且结束于配音时长", () => {
    assert.deepEqual(splitSubtitleLines("大家好！今天给你们推荐一款保温杯，12小时保温。"), ["大家好", "今天给你们推荐一款保温杯", "12小时保温"]);
    assert.ok(splitSubtitleLines("一".repeat(40)).every((l) => l.length <= 16));
    const srt = buildSrt("第一句。第二句话比较长一点！", 10);
    assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,500\n第一句\n/); // 3 字 / 共 12 字 × 10 秒
    assert.match(srt, /--> 00:00:10,000\n第二句话比较长一点\n$/);
    assert.equal(buildSrt("。。。", 5), "");
});

test("真实 ffmpeg：多段不同尺寸、无音轨的素材 + 配音，生成目标尺寸、时长等于配音的成片", { skip: !hasFfmpeg() }, () => {
    const dir = mkdtempSync(join(tmpdir(), "matrix-"));
    const make = (name: string, size: string, dur: number) => {
        const p = join(dir, name);
        execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=25:duration=${dur}`, "-pix_fmt", "yuv420p", p]);
        return { path: p, duration: dur };
    };
    const clips = [make("a.mp4", "640x360", 3), make("b.mp4", "360x640", 2), make("c.mp4", "500x500", 4)];
    const audio = join(dir, "voice.m4a");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=5.5", "-c:a", "aac", audio]);
    const variant = planVariants({ ...base, clipCount: 3, count: 1, options: { clipsPerVideo: 3, jitter: true, mirror: true } }).variants[0];
    const segments = planSegments(clips, variant, 5.5);
    const output = join(dir, "out.mp4");
    execFileSync("ffmpeg", buildRenderArgs({ clips, segments, variant, audio, audioDuration: 5.5, size: { width: 360, height: 640 }, output }), { stdio: "pipe" });
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output]).toString());
    const v = probe.streams.find((s: any) => s.codec_type === "video");
    const a = probe.streams.find((s: any) => s.codec_type === "audio");
    assert.equal(`${v.width}x${v.height}`, "360x640");
    assert.ok(a, "应包含配音音轨");
    assert.ok(Math.abs(Number(probe.format.duration) - 5.5) < 0.2, `duration=${probe.format.duration}`);
});

function hasFfmpeg() {
    try {
        execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

test("多段文案：空行或 --- 分隔，忽略空段", async () => {
    const { splitScripts } = await import("./plan.js");
    assert.deepEqual(splitScripts("第一段\n第一段第二行\n\n第二段\n---\n第三段\n\n\n"), ["第一段\n第一段第二行", "第二段", "第三段"]);
    assert.deepEqual(splitScripts("a\r\n---\r\nb"), ["a", "b"]);
    assert.deepEqual(splitScripts("  \n---\n"), []);
});
