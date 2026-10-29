// 抖音直播间弹幕监听：在直播间网页里监听评论区新增的内容，按文字规律识别互动类型。
// 抖音页面的样式类名是混淆的、经常变，所以只用「评论区」这一层容器定位，具体内容靠文字识别。

export type DouyinEvent = { type: "Enter" | "Like" | "Comment" | "Follow" | "Gift"; username: string; content: string };

/**
 * 识别一条评论区文字，识别不了返回 null。
 * 以纯 JS 源码维护：它要注入到直播间网页里执行，不能经过打包工具改写（会插入辅助函数导致网页里报错）。
 */
export const DOUYIN_PARSE_SOURCE = String.raw`function (text) {
    var t = String(text || "")
        .replace(/[\u200b-\u200f\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!t || t.length > 300) return null;
    if (/^(欢迎来到直播间|直播间公告|系统消息|温馨提示)/.test(t) || /严禁|未成年|文明|违规|绿色直播/.test(t)) return null;
    function action(s) {
        if (/^(来了|进入了?直播间|加入了?直播间)/.test(s)) return "Enter";
        if (/^(为主播点赞了?|为主播点了赞|点赞了)/.test(s)) return "Like";
        if (/^关注了(主播)?/.test(s)) return "Follow";
        if (/^(送出了?|送给主播|送了)/.test(s)) return "Gift";
        if (/^分享了/.test(s)) return "Share";
        return null;
    }
    function giftName(s) {
        return s.replace(/^(送出了?|送给主播|送了)\s*/, "").trim();
    }
    var m = t.match(/^(.{1,30}?)\s*[：:]\s*(.*)$/);
    if (m) {
        var username = m[1].trim();
        var rest = m[2].trim();
        if (!username || !rest) return null;
        var a = action(rest);
        if (a === "Share") return null;
        if (a) return { type: a, username: username, content: a === "Gift" ? giftName(rest) : "" };
        return { type: "Comment", username: username, content: rest };
    }
    var m2 = t.match(/^(.{1,30}?)\s+(来了|进入了?直播间|加入了?直播间|为主播点赞了?|为主播点了赞|点赞了|关注了主播|关注了|送出了?.*|送给主播.*|分享了.*)$/);
    if (m2) {
        var a2 = action(m2[2]);
        if (!a2 || a2 === "Share") return null;
        return { type: a2, username: m2[1].trim(), content: a2 === "Gift" ? giftName(m2[2]) : "" };
    }
    return null;
}`;

/** 解析函数本体（与注入网页的是同一份源码） */
export const parseDouyinChatText: (text: string) => DouyinEvent | null = new Function(
    `return (${DOUYIN_PARSE_SOURCE})`,
)();

/**
 * 注入直播间网页的监听脚本。
 * 通过 webview 的 preload 提供的 window.__page.ipcSendToHost 把事件和状态发回监听窗口。
 */
export const buildDouyinMonitorScript = () => `
(function () {
    if (window.__aigcLiveMonitor) return;
    window.__aigcLiveMonitor = true;
    var parse = ${DOUYIN_PARSE_SOURCE};
    var send = function (type, data) {
        try { window.__page.ipcSendToHost("data", type, data); } catch (e) { console.log("[aigc-monitor]", type, data); }
    };
    var startedAt = Date.now();
    var recent = {};
    var count = 0;
    var unknown = 0;
    var handle = function (text) {
        var ev = parse(text);
        if (!ev) {
            unknown++;
            if (unknown <= 20) console.log("[aigc-monitor] 未识别:", text);
            return;
        }
        // 抖音评论区是虚拟列表，滚动时会重新渲染旧内容：同样的内容 60 秒内只算一次
        var key = ev.type + "|" + ev.username + "|" + ev.content;
        var now = Date.now();
        if (recent[key] && now - recent[key] < 60000) return;
        recent[key] = now;
        count++;
        send("event", { type: ev.type, data: { source: "douyin", username: ev.username, content: ev.content } });
    };
    var findChatRoots = function () {
        var list = Array.prototype.slice.call(document.querySelectorAll('[class*="chatroom"]'));
        // 只保留最外层的评论区容器
        return list.filter(function (el) {
            return !list.some(function (o) { return o !== el && o.contains(el); });
        });
    };
    var observed = [];
    var onMutations = function (mutations) {
        // 页面刚打开时会一次性渲染历史评论，不当成新互动
        if (Date.now() - startedAt < 3000) return;
        mutations.forEach(function (m) {
            Array.prototype.forEach.call(m.addedNodes, function (node) {
                if (node.nodeType !== 1) return;
                var text = node.innerText || node.textContent || "";
                text.split(/\\n{2,}/).forEach(function (part) { handle(part.replace(/\\n/g, " ")); });
            });
        });
    };
    var observer = new MutationObserver(onMutations);
    var attach = function () {
        findChatRoots().forEach(function (root) {
            if (observed.indexOf(root) >= 0) return;
            observed.push(root);
            observer.observe(root, { childList: true, subtree: true });
        });
    };
    setInterval(function () {
        attach();
        if (!observed.length) {
            send("status", { type: "error", msg: "没有找到评论区：请确认已进入直播间（可能需要先登录抖音）" });
        } else {
            send("status", { type: "success", msg: "监听中 · 已识别 " + count + " 条互动" });
        }
    }, 3000);
    attach();
    send("status", { type: "info", msg: "监听脚本已加载，正在查找评论区…" });
})();
`;

/** 从分享文案或地址里取出抖音直播间地址 */
export const normalizeDouyinRoomUrl = (input: string): string => {
    const s = String(input ?? "").trim();
    const url = s.match(/https?:\/\/[^\s，。]+/)?.[0];
    if (url && /douyin\.com/.test(url)) return url;
    if (/^\d{5,}$/.test(s)) return `https://live.douyin.com/${s}`;
    return "";
};
