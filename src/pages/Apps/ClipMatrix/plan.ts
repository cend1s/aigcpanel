// 剪辑矩阵的“规划”部分：决定每条成片用哪段文案、哪个音色、哪些素材及顺序、做哪些去重处理。
// 纯函数，不依赖 Electron，可单独测试。同一个 seed 得到同样的结果，便于复现。

export type MatrixOptions = {
    /** 每条成片使用的素材片段数 */
    clipsPerVideo: number;
    /** 轻微变速（0.95~1.05）与放大裁切（1.00~1.08），降低成片之间的重复度 */
    jitter: boolean;
    /** 随机水平镜像 */
    mirror: boolean;
};

export type MatrixInput = {
    clipCount: number;
    scriptCount: number;
    voiceCount: number;
    count: number;
    seed: number;
    options: MatrixOptions;
};

export type Variant = {
    index: number;
    scriptIndex: number;
    voiceIndex: number;
    /** 素材下标，按播放顺序 */
    clipOrder: number[];
    speed: number;
    zoom: number;
    mirror: boolean;
    /** 用于选取每段素材起点的随机种子 */
    seed: number;
};

export const MAX_VARIANTS = 200;

/** mulberry32：小而稳定的伪随机数生成器 */
export const rng = (seed: number) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const shuffle = <T>(arr: T[], rand: () => number) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 理论上不重复的组合数（文案 × 音色 × 素材排列），用于提示用户“最多能出多少条不重复的” */
export const maxUniqueCombos = (input: Omit<MatrixInput, "count" | "seed">) => {
    const k = Math.min(input.options.clipsPerVideo, input.clipCount);
    let perm = 1;
    for (let i = 0; i < k; i++) perm *= input.clipCount - i;
    return input.scriptCount * input.voiceCount * perm;
};

export const validateInput = (input: MatrixInput): string | null => {
    if (input.clipCount < 1) return "至少需要 1 段素材";
    if (input.scriptCount < 1) return "至少需要 1 段文案";
    if (input.voiceCount < 1) return "至少需要 1 个音色";
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_VARIANTS) return `生成数量需为 1-${MAX_VARIANTS}`;
    if (!Number.isInteger(input.options.clipsPerVideo) || input.options.clipsPerVideo < 1 || input.options.clipsPerVideo > 20) {
        return "每条使用的素材数需为 1-20";
    }
    return null;
};

/**
 * 规划成片。文案与音色轮流分配，保证各组合用得均匀；素材顺序随机且整体不重复。
 * 不重复组合不够时，返回的数量会少于 count，并标记 exhausted。
 */
export const planVariants = (input: MatrixInput): { variants: Variant[]; exhausted: boolean } => {
    const err = validateInput(input);
    if (err) throw new Error(err);
    const rand = rng(input.seed);
    const k = Math.min(input.options.clipsPerVideo, input.clipCount);
    const limit = Math.min(input.count, maxUniqueCombos({ ...input, options: { ...input.options, clipsPerVideo: k } }));
    const seen = new Set<string>();
    const variants: Variant[] = [];
    const clipIdx = Array.from({ length: input.clipCount }, (_, i) => i);
    const pairs = input.scriptCount * input.voiceCount;
    let attempts = 0;
    while (variants.length < limit && attempts < limit * 50) {
        const i = attempts++;
        const pair = i % pairs;
        const scriptIndex = pair % input.scriptCount;
        const voiceIndex = Math.floor(pair / input.scriptCount) % input.voiceCount;
        const clipOrder = shuffle(clipIdx, rand).slice(0, k);
        const key = `${scriptIndex}|${voiceIndex}|${clipOrder.join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        variants.push({
            index: variants.length,
            scriptIndex,
            voiceIndex,
            clipOrder,
            speed: input.options.jitter ? round2(0.95 + rand() * 0.1) : 1,
            zoom: input.options.jitter ? round2(1 + rand() * 0.08) : 1,
            mirror: input.options.mirror ? rand() < 0.5 : false,
            seed: Math.floor(rand() * 2 ** 31),
        });
    }
    return { variants, exhausted: variants.length < input.count };
};

/** 多段文案的输入格式：段与段之间用空行或单独一行 --- 分隔 */
export const splitScripts = (text: string): string[] =>
    text
        .replace(/\r\n/g, "\n")
        .split(/\n\s*(?:-{3,}\s*)?\n|\n\s*-{3,}\s*(?:\n|$)/)
        .map((s) => s.trim())
        .filter((s) => s && !/^-{3,}$/.test(s));
