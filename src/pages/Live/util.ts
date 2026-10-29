// 直播知识库与互动事件的公共定义。这里只放纯函数，直播引擎（主进程）与界面共用。

/** 观众互动事件（抖音弹幕监听输出的 type） */
export const EventTypes = [
    { value: "Enter", label: "用户进入", labelKey: "live.eventType.enter" },
    { value: "Like", label: "用户点赞", labelKey: "live.eventType.like" },
    { value: "Comment", label: "用户评论", labelKey: "live.eventType.comment" },
    { value: "Follow", label: "用户关注", labelKey: "live.eventType.follow" },
    { value: "Gift", label: "用户送礼", labelKey: "live.eventType.gift" },
] as const;

export type LiveEventType = (typeof EventTypes)[number]["value"];

/** 系统知识可响应的事件：评论走「用户知识」关键词匹配，不在这里 */
export const SystemEventTypes = EventTypes.filter((e) => e.value !== "Comment");

export const eventTypeToLabel = (type: string) =>
    EventTypes.find((e) => e.value === type)?.label ?? type;

export const KnowledgeTypes = [
    { value: "flowTalk", labelKey: "live.kb.flowTalk", descKey: "live.kb.flowTalkDesc" },
    { value: "user", labelKey: "live.kb.user", descKey: "live.kb.userDesc" },
    { value: "system", labelKey: "live.kb.system", descKey: "live.kb.systemDesc" },
    { value: "flowVideo", labelKey: "live.kb.flowVideo", descKey: "live.kb.flowVideoDesc" },
] as const;

export type KnowledgeType = (typeof KnowledgeTypes)[number]["value"];

/** 话术里可用的变量 */
export const TALK_VARIABLES = ["{username}"];

type KnowledgeContentLike = {
    reply?: string;
    replies?: { value?: string }[];
    keywords?: string;
};

/** 一条知识的全部话术：主回复 + 备选回复，去空 */
export const talksOf = (content: KnowledgeContentLike): string[] =>
    [content.reply ?? "", ...(content.replies ?? []).map((r) => r?.value ?? "")]
        .map((s) => s.trim())
        .filter(Boolean);

/** 编辑框里的话术列表 → 存储字段（第一条为主回复，其余为备选） */
export const talksToContent = (talks: string[]) => {
    const list = talks.map((s) => s.trim()).filter(Boolean);
    return { reply: list[0] ?? "", replies: list.slice(1).map((value) => ({ value })) };
};

/** 关键词以逗号、顿号、空白或换行分隔 */
export const parseKeywords = (keywords?: string): string[] =>
    Array.from(
        new Set(
            String(keywords ?? "")
                .split(/[,，、\s]+/)
                .map((s) => s.trim())
                .filter(Boolean),
        ),
    );

export const joinKeywords = (list: string[]) => parseKeywords(list.join(",")).join(",");

/**
 * 评论命中的用户知识：命中关键词最长的优先（「多少钱一斤」比「多少钱」更具体）。
 * 不区分大小写。
 */
export const matchUserKnowledge = <T extends { content: KnowledgeContentLike & { enable?: boolean; type?: string } }>(
    comment: string,
    records: T[],
): T | null => {
    const text = String(comment ?? "").toLowerCase();
    if (!text) return null;
    let best: T | null = null;
    let bestLen = 0;
    for (const r of records) {
        if (r.content?.type !== "user" || r.content?.enable === false) continue;
        if (!talksOf(r.content).length) continue;
        for (const kw of parseKeywords(r.content.keywords)) {
            if (kw.length > bestLen && text.includes(kw.toLowerCase())) {
                best = r;
                bestLen = kw.length;
            }
        }
    }
    return best;
};

/** 替换话术变量；昵称为空时用默认称呼（如「宝子」） */
export const renderTalk = (talk: string, vars: { username?: string; defaultUsername?: string }) =>
    talk.replace(/\{username\}/g, (vars.username || "").trim() || vars.defaultUsername || "");

/**
 * 解析大模型返回的同义话术：优先按 JSON 数组 [{content}] 解析，
 * 兼容外面包了 ```json 代码块，或直接逐行返回的情况。
 */
export const parseGeneratedTalks = (raw: string): string[] => {
    const text = String(raw ?? "").replace(/```(?:json)?/gi, "").trim();
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start >= 0 && end > start) {
        try {
            const arr = JSON.parse(text.slice(start, end + 1));
            if (Array.isArray(arr)) {
                return arr
                    .map((x) => (typeof x === "string" ? x : x?.content ?? ""))
                    .map((s: string) => String(s).trim())
                    .filter(Boolean);
            }
        } catch {
            // 继续按行解析
        }
    }
    return text
        .split(/\n+/)
        .map((s) => s.replace(/^\s*(?:[-*•]|\d+[.、)）])\s*/, "").trim())
        .filter(Boolean);
};
