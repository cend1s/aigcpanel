// 直播违禁词：平台敏感词 + 广告法禁用词。可在「设置 → 数据配置」里改（存储键 LiveBlackWordContent）。
// 检测与高亮是纯函数，直播引擎播报前也用它过滤。

export const LiveBlackWordContent = [
    // 引流到其他平台
    "快手",
    "微信",
    "QQ",
    "微博",
    "小红书",
    "知乎",
    "B站",
    "哔哩哔哩",
    "淘宝",
    "天猫",
    "京东",
    "拼多多",
    "支付宝",
    "加V",
    "私聊",
    "私信下单",

    // 广告法禁用词
    "最好",
    "最棒",
    "最佳",
    "最优",
    "最高级",
    "最先进",
    "最新技术",
    "最便宜",
    "第一",
    "独一无二",
    "唯一",
    "国家级",
    "世界级",
    "顶级",
    "极品",
    "绝对",
    "万能",
    "100%",
    "祖传",
    "特效",
    "根治",
    "全网最低",
].join(",");

export const parseBlackWords = (content: string): string[] =>
    Array.from(
        new Set(
            String(content ?? "")
                .split(/[,，\n]+/)
                .map((w) => w.trim())
                .filter(Boolean),
        ),
    );

export type BlackWordViolation = { word: string; index: number };

/** 找出文本中所有违禁词出现的位置；长词优先，被长词覆盖的短词不重复计 */
export const findBlackWords = (text: string, words: string[]): BlackWordViolation[] => {
    const src = String(text ?? "");
    const sorted = [...words].sort((a, b) => b.length - a.length);
    const taken = new Array<boolean>(src.length).fill(false);
    const out: BlackWordViolation[] = [];
    for (const word of sorted) {
        let from = 0;
        while (word && from <= src.length) {
            const index = src.indexOf(word, from);
            if (index === -1) break;
            if (!taken.slice(index, index + word.length).some(Boolean)) {
                out.push({ word, index });
                taken.fill(true, index, index + word.length);
            }
            from = index + word.length;
        }
    }
    return out.sort((a, b) => a.index - b.index);
};

const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 违禁词高亮成 HTML；先转义原文，避免话术里的尖括号被当成标签 */
export const highlightBlackWordsHtml = (text: string, words: string[]): string => {
    const src = String(text ?? "");
    let html = "";
    let pos = 0;
    for (const v of findBlackWords(src, words)) {
        html += escapeHtml(src.slice(pos, v.index));
        html += `<span class="live-black-word">${escapeHtml(v.word)}</span>`;
        pos = v.index + v.word.length;
    }
    return html + escapeHtml(src.slice(pos));
};

/** 读取当前生效的违禁词（用户在数据配置里改过则用改过的） */
export const loadBlackWords = async (): Promise<string[]> => {
    const { getDataContent } = await import("../../../components/common/dataConfig");
    return parseBlackWords(await getDataContent("LiveBlackWordContent", LiveBlackWordContent));
};
