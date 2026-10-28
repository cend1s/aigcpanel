// 资产中心的纯逻辑：类型识别、标签、筛选、任务结果收集规则。不依赖 Electron，可单独测试。

export type AssetType = "video" | "image" | "audio" | "text";

export type AssetContent = {
    type: AssetType;
    /** 媒体文件路径（文本资产为空） */
    file: string;
    /** 文本资产内容 */
    text: string;
    tags: string[];
    note: string;
    /** 来源：手动导入、电商文案、任务结果 */
    source: "upload" | "copywriting" | "task";
    /** 来源任务 id（避免重复导入同一结果） */
    sourceTaskId: string;
    /** 文件是否由资产中心持有：持有的文件在删除资产时一并删除，引用的任务结果文件不删 */
    owned: boolean;
    duration: number;
    size: number;
    createdAt: number;
};

export type AssetRecord = { id?: number; title: string; content: AssetContent };

const EXT: Record<AssetType, string[]> = {
    video: ["mp4", "mov", "mkv", "avi", "webm"],
    image: ["png", "jpg", "jpeg", "webp", "gif", "bmp"],
    audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg"],
    text: ["txt", "md"],
};
export const MEDIA_EXTENSIONS = [...EXT.video, ...EXT.image, ...EXT.audio];

export const detectType = (path: string): AssetType | null => {
    const ext = path.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
    for (const [type, exts] of Object.entries(EXT) as [AssetType, string[]][]) {
        if (exts.includes(ext)) return type;
    }
    return null;
};

/** 用户输入的标签：逗号、顿号、空格分隔，去重去空，单个不超过 20 字，最多 10 个 */
export const normalizeTags = (input: string | string[]): string[] => {
    const raw = Array.isArray(input) ? input : input.split(/[,，、\s]+/);
    const out: string[] = [];
    for (const t of raw.map((x) => x.trim().replace(/^#/, "").slice(0, 20))) {
        if (t && !out.includes(t)) out.push(t);
        if (out.length >= 10) break;
    }
    return out;
};

/** 所有标签按使用次数从多到少 */
export const collectTags = (assets: AssetRecord[]): { tag: string; count: number }[] => {
    const m = new Map<string, number>();
    for (const a of assets) for (const t of a.content.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
};

export const filterAssets = (
    assets: AssetRecord[],
    f: { type?: AssetType | ""; tag?: string; keyword?: string },
): AssetRecord[] => {
    const kw = (f.keyword ?? "").trim().toLowerCase();
    return assets.filter((a) => {
        if (f.type && a.content.type !== f.type) return false;
        if (f.tag && !(a.content.tags ?? []).includes(f.tag)) return false;
        if (kw) {
            const hay = [a.title, a.content.text, a.content.note, ...(a.content.tags ?? [])].join("\n").toLowerCase();
            if (!hay.includes(kw)) return false;
        }
        return true;
    });
};

/** 可以收进资产中心的任务结果：业务 → 结果字段与资产类型 */
export const TASK_RESULT_SOURCES: Record<string, { field: string; type: AssetType; tag: string }[]> = {
    TextToImage: [{ field: "url", type: "image", tag: "文生图" }],
    ImageToImage: [{ field: "url", type: "image", tag: "图生图" }],
    TextToVideo: [{ field: "url", type: "video", tag: "文生视频" }],
    ImageToVideo: [{ field: "url", type: "video", tag: "图生视频" }],
    VideoGenFlow: [{ field: "url", type: "video", tag: "口播视频" }],
    VideoGen: [{ field: "url", type: "video", tag: "数字人视频" }],
    ClipMatrix: [{ field: "url", type: "video", tag: "剪辑矩阵" }],
    LongTextTts: [{ field: "url", type: "audio", tag: "配音" }],
    SoundGenerate: [{ field: "url", type: "audio", tag: "配音" }],
};

type TaskLike = { id: string | number; biz: string; title: string; status?: string; result?: any };

/** 找出尚未收录的成功任务结果，返回待创建的资产 */
export const pendingTaskAssets = (tasks: TaskLike[], existing: AssetRecord[]): Omit<AssetRecord, "id">[] => {
    const imported = new Set(existing.map((a) => `${a.content.sourceTaskId}`).filter(Boolean));
    const out: Omit<AssetRecord, "id">[] = [];
    for (const task of tasks) {
        if (task.status !== "success") continue;
        for (const src of TASK_RESULT_SOURCES[task.biz] ?? []) {
            const file = task.result?.[src.field];
            const key = `${task.biz}:${task.id}:${src.field}`;
            if (typeof file !== "string" || !file || imported.has(key)) continue;
            out.push({
                title: task.title || src.tag,
                content: {
                    type: src.type,
                    file,
                    text: "",
                    tags: [src.tag],
                    note: "",
                    source: "task",
                    sourceTaskId: key,
                    owned: false,
                    duration: 0,
                    size: 0,
                    createdAt: Date.now(),
                },
            });
        }
    }
    return out;
};
