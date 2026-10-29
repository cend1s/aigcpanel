import assert from "node:assert/strict";
import { test } from "node:test";
import { DOUYIN_PARSE_SOURCE, buildDouyinMonitorScript, normalizeDouyinRoomUrl, parseDouyinChatText } from "./douyin.js";

test("评论：昵称：内容（全角/半角冒号、多余空白）", () => {
    assert.deepEqual(parseDouyinChatText("小王：这个多少钱"), { type: "Comment", username: "小王", content: "这个多少钱" });
    assert.deepEqual(parseDouyinChatText("  Tom :  how much \n"), { type: "Comment", username: "Tom", content: "how much" });
    // 内容里还有冒号，只按第一个冒号切
    assert.deepEqual(parseDouyinChatText("阿强：价格：多少"), { type: "Comment", username: "阿强", content: "价格：多少" });
});

test("进入、点赞、关注、送礼：有冒号和没冒号两种写法", () => {
    assert.deepEqual(parseDouyinChatText("阿强 来了"), { type: "Enter", username: "阿强", content: "" });
    assert.deepEqual(parseDouyinChatText("张 三 进入直播间"), { type: "Enter", username: "张 三", content: "" });
    assert.deepEqual(parseDouyinChatText("小红：为主播点赞了"), { type: "Like", username: "小红", content: "" });
    assert.deepEqual(parseDouyinChatText("小红 为主播点赞了"), { type: "Like", username: "小红", content: "" });
    assert.deepEqual(parseDouyinChatText("老李 关注了主播"), { type: "Follow", username: "老李", content: "" });
    assert.deepEqual(parseDouyinChatText("老李：送出了 小心心 ×1"), { type: "Gift", username: "老李", content: "小心心 ×1" });
    assert.deepEqual(parseDouyinChatText("老李 送出了玫瑰"), { type: "Gift", username: "老李", content: "玫瑰" });
});

test("系统公告、分享、空内容、普通界面文字不识别", () => {
    assert.equal(parseDouyinChatText("欢迎来到直播间！抖音严禁未成年人直播或打赏"), null);
    assert.equal(parseDouyinChatText("小王：分享了直播间"), null);
    assert.equal(parseDouyinChatText("小王 分享了直播间"), null);
    assert.equal(parseDouyinChatText("小王："), null);
    assert.equal(parseDouyinChatText("在线观众 1.2万"), null);
    assert.equal(parseDouyinChatText(""), null);
    assert.equal(parseDouyinChatText("x".repeat(400)), null);
});

test("解析函数可以单独转成字符串执行（注入直播间网页用）", () => {
    const fn = new Function(`return (${DOUYIN_PARSE_SOURCE})`)();
    assert.deepEqual(fn("小王：多少钱"), { type: "Comment", username: "小王", content: "多少钱" });
    const script = buildDouyinMonitorScript();
    assert.ok(script.includes("MutationObserver"));
    // 整段脚本语法正确
    assert.doesNotThrow(() => new Function(script));
});

test("直播间地址：分享文案、完整地址、房间号", () => {
    assert.equal(normalizeDouyinRoomUrl("7-# 快来看 https://live.douyin.com/123456789 复制此链接"), "https://live.douyin.com/123456789");
    assert.equal(normalizeDouyinRoomUrl("123456789"), "https://live.douyin.com/123456789");
    assert.equal(normalizeDouyinRoomUrl("https://example.com/x"), "");
    assert.equal(normalizeDouyinRoomUrl(""), "");
});
