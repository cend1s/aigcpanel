import { StorageUtil } from "../../../lib/storage";

// 把文案送到原项目已有的功能页：目标页挂载时会从 localStorage 读取草稿作为初始内容。
// key 必须与目标页面里的草稿 key 一致（handoff.test.ts 会校验源码，防止改名后悄悄失效）。
export type HandoffTarget = {
    id: "videoGenFlow" | "longTextTts";
    storageKey: string;
    /** 校验用：持有该 key 的源文件 */
    sourceFile: string;
    route: { path: string; query: Record<string, string> };
};

export const handoffTargets: Record<HandoffTarget["id"], HandoffTarget> = {
    // 一键合成：文案 → 配音 → 数字人视频
    videoGenFlow: {
        id: "videoGenFlow",
        storageKey: "VideoGenFlowCreate.formData",
        sourceFile: "src/pages/Apps/VideoGenFlow/components/VideoGenFlowCreate.vue",
        route: { path: "/video", query: { tab: "VideoGenFlow" } },
    },
    // 长文本转音频
    longTextTts: {
        id: "longTextTts",
        storageKey: "LongTextTtsCreate.formData",
        sourceFile: "src/pages/Apps/LongTextTts/components/LongTextTtsCreate.vue",
        route: { path: "/tool", query: { tab: "LongTextTts" } },
    },
};

/**
 * 把生成的营销文案整理成适合朗读的文本：去掉话题标签、表情符号、Markdown 标记、链接，合并多余空白。
 * 只做减法，不改写内容。
 */
export const toSpokenText = (text: string): string =>
    text
        .replace(/https?:\/\/\S+/g, "")
        .replace(/#[^\s#，。！？,.!?]+/g, "") // 话题标签 #xxx
        .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
        .replace(/^\s{0,3}#{1,6}\s*/gm, "") // Markdown 标题
        .replace(/\*\*|__|`/g, "")
        .replace(/^\s*[-*•]\s+/gm, "")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

/** 写入目标页草稿并跳转；返回实际送出的文本。 */
export const handoff = (
    id: HandoffTarget["id"],
    text: string,
    navigate: (route: HandoffTarget["route"]) => unknown,
): string => {
    const target = handoffTargets[id];
    const spoken = toSpokenText(text);
    if (!spoken) {
        throw new Error("EmptyText");
    }
    StorageUtil.set(target.storageKey, { text: spoken });
    navigate(target.route);
    return spoken;
};
