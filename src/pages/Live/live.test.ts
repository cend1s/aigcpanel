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
