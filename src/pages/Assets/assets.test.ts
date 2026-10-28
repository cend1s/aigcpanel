import assert from "node:assert/strict";
import { test } from "node:test";
import { collectTags, detectType, filterAssets, normalizeTags, pendingTaskAssets, type AssetRecord } from "./assets.js";

const a = (title: string, type: any, tags: string[], text = ""): AssetRecord => ({
    title,
    content: { type, file: "", text, tags, note: "", source: "upload", sourceTaskId: "", owned: true, duration: 0, size: 0, createdAt: 0 },
});

test("按扩展名识别类型（忽略大小写与查询串）", () => {
    assert.equal(detectType("/a/B.MP4"), "video");
    assert.equal(detectType("x.jpeg?x=1"), "image");
    assert.equal(detectType("voice.m4a"), "audio");
    assert.equal(detectType("readme"), null);
    assert.equal(detectType("a.exe"), null);
});

test("标签规范化：多种分隔符、去重、去 #、限长限量", () => {
    assert.deepEqual(normalizeTags("保温杯, 夏季，#好物 、保温杯  新品"), ["保温杯", "夏季", "好物", "新品"]);
    assert.equal(normalizeTags("x".repeat(30))[0].length, 20);
    assert.equal(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`)).length, 10);
});

test("筛选：类型、标签、关键字（标题/文本/标签）组合", () => {
    const list = [a("保温杯展示", "video", ["保温杯"]), a("杯子主图", "image", ["保温杯", "主图"]), a("口播", "text", ["文案"], "12小时保温")];
    assert.deepEqual(filterAssets(list, { type: "video" }).map((x) => x.title), ["保温杯展示"]);
    assert.deepEqual(filterAssets(list, { tag: "保温杯" }).map((x) => x.title), ["保温杯展示", "杯子主图"]);
    assert.deepEqual(filterAssets(list, { keyword: "12小时" }).map((x) => x.title), ["口播"]);
    assert.deepEqual(filterAssets(list, { type: "image", keyword: "主图" }).map((x) => x.title), ["杯子主图"]);
    assert.deepEqual(collectTags(list), [{ tag: "保温杯", count: 2 }, { tag: "主图", count: 1 }, { tag: "文案", count: 1 }]);
});

test("任务结果收录：只收成功且有文件的已知业务，已收录的不重复", () => {
    const tasks = [
        { id: 1, biz: "TextToImage", title: "猫", status: "success", result: { url: "/hub/a.png" } },
        { id: 2, biz: "ClipMatrix", title: "矩阵 #1", status: "success", result: { url: "/hub/b.mp4" } },
        { id: 3, biz: "ClipMatrix", title: "矩阵 #2", status: "fail", result: {} },
        { id: 4, biz: "VideoCompress", title: "压缩", status: "success", result: { url: "/hub/c.mp4" } },
        { id: 5, biz: "TextToVideo", title: "无结果", status: "success", result: {} },
    ];
    const first = pendingTaskAssets(tasks, []);
    assert.deepEqual(first.map((x) => [x.title, x.content.type, x.content.owned]), [["猫", "image", false], ["矩阵 #1", "video", false]]);
    const again = pendingTaskAssets(tasks, first as AssetRecord[]);
    assert.equal(again.length, 0);
});
