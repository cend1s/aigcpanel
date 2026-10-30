import assert from "node:assert/strict";
import { test } from "node:test";
import { findBlackWords, highlightBlackWordsHtml, parseBlackWords } from "./config/blackWord.js";
import {
    joinKeywords,
    matchUserKnowledge,
    parseGeneratedTalks,
    parseKeywords,
    renderTalk,
    talksOf,
    talksToContent,
} from "./util.js";

test("话术：主回复 + 备选回复互转，去掉空行", () => {
    const c = talksToContent([" 欢迎来到直播间 ", "", "宝子们好"]);
    assert.deepEqual(c, { reply: "欢迎来到直播间", replies: [{ value: "宝子们好" }] });
    assert.deepEqual(talksOf(c), ["欢迎来到直播间", "宝子们好"]);
    assert.deepEqual(talksOf({}), []);
});

test("关键词：中英文逗号、顿号、空格都能分隔，并去重", () => {
    assert.deepEqual(parseKeywords("多少钱，价格、 价格 price,"), ["多少钱", "价格", "price"]);
    assert.equal(joinKeywords(["多少钱", " 价格 ", "多少钱"]), "多少钱,价格");
});

test("评论匹配：命中关键词最长的知识优先，停用和没有话术的不参与", () => {
    const kb = [
        { id: 1, content: { type: "user", enable: true, keywords: "多少钱", reply: "价格看小黄车" } },
        { id: 2, content: { type: "user", enable: true, keywords: "多少钱一斤", reply: "一斤 29.9" } },
        { id: 3, content: { type: "user", enable: false, keywords: "发货", reply: "48 小时发货" } },
        { id: 4, content: { type: "user", enable: true, keywords: "包邮", reply: "" } },
        { id: 5, content: { type: "flowTalk", enable: true, keywords: "多少钱一斤啊", reply: "x" } },
        { id: 6, content: { type: "user", enable: true, keywords: "Size", reply: "尺码看详情" } },
    ];
    assert.equal(matchUserKnowledge("这个多少钱一斤呀", kb)?.id, 2);
    assert.equal(matchUserKnowledge("多少钱", kb)?.id, 1);
    assert.equal(matchUserKnowledge("什么时候发货", kb), null);
    assert.equal(matchUserKnowledge("包邮吗", kb), null);
    assert.equal(matchUserKnowledge("what size", kb)?.id, 6);
    assert.equal(matchUserKnowledge("", kb), null);
});

test("话术变量：替换观众昵称，昵称为空时用默认称呼", () => {
    assert.equal(renderTalk("欢迎{username}来到直播间，{username}好", { username: "小王" }), "欢迎小王来到直播间，小王好");
    assert.equal(renderTalk("欢迎{username}", { username: " ", defaultUsername: "宝子" }), "欢迎宝子");
});

test("AI 扩写结果：JSON 数组、代码块包裹、逐行编号三种格式都能解析", () => {
    assert.deepEqual(parseGeneratedTalks('[{"content":"a"},{"content":" b "}]'), ["a", "b"]);
    assert.deepEqual(parseGeneratedTalks('好的：\n```json\n[{"content":"c"}]\n```'), ["c"]);
    assert.deepEqual(parseGeneratedTalks("1. 第一句\n2、第二句\n- 第三句"), ["第一句", "第二句", "第三句"]);
    assert.deepEqual(parseGeneratedTalks('["x","y"]'), ["x", "y"]);
});

test("违禁词：长词优先、不重复计数，位置正确", () => {
    const words = parseBlackWords("最好, 最好的,第一\n全网最低");
    assert.deepEqual(words, ["最好", "最好的", "第一", "全网最低"]);
    assert.deepEqual(findBlackWords("这是最好的产品，全网最低，第一名", words), [
        { word: "最好的", index: 2 },
        { word: "全网最低", index: 8 },
        { word: "第一", index: 13 },
    ]);
    assert.deepEqual(findBlackWords("没有问题", words), []);
});

test("违禁词高亮：先转义原文，尖括号不会变成标签", () => {
    const html = highlightBlackWordsHtml('<img src=x onerror="a">最好', ["最好"]);
    assert.equal(html, '&lt;img src=x onerror=&quot;a&quot;&gt;<span class="live-black-word">最好</span>');
});

test("本地路径转 file 地址：Windows 盘符、空格与中文", async () => {
    const { toFileUrl } = await import("./util.js");
    assert.equal(toFileUrl("C:\\Users\\张三\\a b.mp3"), "file:///C:/Users/%E5%BC%A0%E4%B8%89/a%20b.mp3");
    assert.equal(toFileUrl("/home/u/a.mp3"), "file:///home/u/a.mp3");
    assert.equal(toFileUrl("https://x/a.mp3"), "https://x/a.mp3");
    assert.equal(toFileUrl("/tmp/第#1?.wav"), "file:///tmp/%E7%AC%AC%231%3F.wav");
});

test("大模型回复整理：去 Markdown/思考标签、SKIP 判空、超长截到完整句子", async () => {
    const { cleanLlmReply, buildKnowledgeContext, fillLlmPrompt } = await import("./config/llmReply.js");
    assert.equal(cleanLlmReply("<think>想一下</think>**包邮哦**，\n48小时发货"), "包邮哦， 48小时发货");
    assert.equal(cleanLlmReply("SKIP"), "");
    assert.equal(cleanLlmReply("  "), "");
    assert.equal(cleanLlmReply("「好的呢」"), "好的呢");
    const long = "这款保温杯保温十二小时。" + "非常好用".repeat(30);
    assert.equal(cleanLlmReply(long, 40).length <= 40, true);
    assert.equal(cleanLlmReply("这款杯子保温十二小时，一键开盖超方便。后面还有很多很多很多很多很多很多很多很多内容", 30), "这款杯子保温十二小时，一键开盖超方便。");
    const ctx = buildKnowledgeContext([
        { content: { type: "flowTalk", reply: "保温十二小时" } },
        { content: { type: "user", keywords: "多少钱,价格", reply: "看一号链接" } },
        { content: { type: "system", reply: "欢迎" } },
    ]);
    assert.equal(ctx, "- 保温十二小时\n- 关于「多少钱、价格」看一号链接");
    assert.equal(buildKnowledgeContext([]), "（暂无资料）");
    assert.equal(fillLlmPrompt("{username}问：{comment}{x}", { username: "小王", comment: "多少钱" }), "小王问：多少钱{x}");
});
