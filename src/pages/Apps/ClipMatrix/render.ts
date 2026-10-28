import { rng, type Variant } from "./plan";

// 剪辑矩阵的“渲染”部分：把一条规划好的成片变成 ffmpeg 参数。纯函数，可在 Node 中用真实 ffmpeg 测试。

export type Clip = { path: string; duration: number };
export type Segment = { clip: number; start: number; inLength: number; outLength: number };
export type RenderSize = { width: number; height: number };

export const RATIOS: Record<string, RenderSize> = {
    "9:16": { width: 1080, height: 1920 },
    "16:9": { width: 1920, height: 1080 },
    "1:1": { width: 1080, height: 1080 },
    "3:4": { width: 1080, height: 1440 },
};

const MIN_SEGMENT = 1.5;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const even = (n: number) => Math.round(n / 2) * 2;

/**
 * 切分片段，使画面总时长覆盖配音时长：按素材顺序平均分配，每段从素材里随机选一个起点；
 * 素材太短时整轮循环使用。变速时，输出 1 秒需要 speed 秒的原素材。
 */
export const planSegments = (clips: Clip[], variant: Variant, audioDuration: number): Segment[] => {
    if (!(audioDuration > 0)) throw new Error("配音时长无效");
    const rand = rng(variant.seed);
    const order = variant.clipOrder;
    const target = Math.max(MIN_SEGMENT, audioDuration / order.length);
    const segments: Segment[] = [];
    let covered = 0;
    for (let i = 0; covered < audioDuration - 0.01 && i < 500; i++) {
        const clipIndex = order[i % order.length];
        const clip = clips[clipIndex];
        if (!clip || !(clip.duration > 0.1)) throw new Error(`素材 ${clipIndex + 1} 时长无效`);
        const remain = audioDuration - covered;
        const outLength = Math.min(target, remain, clip.duration / variant.speed);
        const inLength = outLength * variant.speed;
        const start = (clip.duration - inLength) * rand();
        segments.push({ clip: clipIndex, start: r3(start), inLength: r3(inLength), outLength: r3(outLength) });
        covered += outLength;
    }
    return segments;
};

/** 构建 ffmpeg 参数：每段单独 -ss/-t 输入，统一缩放裁切到目标尺寸后拼接，配上配音，时长以配音为准 */
export const buildRenderArgs = (input: {
    clips: Clip[];
    segments: Segment[];
    variant: Variant;
    audio: string;
    audioDuration: number;
    size: RenderSize;
    output: string;
    fps?: number;
}): string[] => {
    const { segments, variant, size } = input;
    const fps = input.fps ?? 30;
    const zw = even(size.width * variant.zoom);
    const zh = even(size.height * variant.zoom);
    const args: string[] = ["-hide_banner", "-y"];
    for (const s of segments) {
        args.push("-ss", String(s.start), "-t", String(s.inLength), "-i", input.clips[s.clip].path);
    }
    args.push("-i", input.audio);
    const parts = segments.map((_, i) =>
        [
            `[${i}:v]scale=${zw}:${zh}:force_original_aspect_ratio=increase`,
            `crop=${size.width}:${size.height}`,
            "setsar=1",
            `fps=${fps}`,
            ...(variant.mirror ? ["hflip"] : []),
            `setpts=(PTS-STARTPTS)/${variant.speed}[v${i}]`,
        ].join(","),
    );
    const concatInputs = segments.map((_, i) => `[v${i}]`).join("");
    const filter = `${parts.join(";")};${concatInputs}concat=n=${segments.length}:v=1:a=0[vout]`;
    args.push(
        "-filter_complex", filter,
        "-map", "[vout]",
        "-map", `${segments.length}:a:0`,
        "-t", String(r3(input.audioDuration)),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        input.output,
    );
    return args;
};

const ts = (sec: number) => {
    const ms = Math.round(sec * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
};

/** 把句子切成适合字幕的短句（按标点断句，过长再按字数切） */
export const splitSubtitleLines = (text: string, maxChars = 16): string[] =>
    text
        .replace(/\s+/g, " ")
        .split(/(?<=[。！？!?；;，,、\n])/)
        .map((s) => s.replace(/[。！？!?；;，,、]+$/, "").trim())
        .filter(Boolean)
        .flatMap((s) => {
            const chunks: string[] = [];
            for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars));
            return chunks;
        });

/** 用文案生成 SRT：按每句字数占比分配时间，总时长与配音一致（没有逐字时间戳时的近似做法） */
export const buildSrt = (text: string, duration: number): string => {
    const lines = splitSubtitleLines(text);
    if (lines.length === 0) return "";
    const total = lines.reduce((s, l) => s + l.length, 0);
    let t = 0;
    return lines
        .map((line, i) => {
            const start = t;
            t = i === lines.length - 1 ? duration : t + (duration * line.length) / total;
            return `${i + 1}\n${ts(start)} --> ${ts(t)}\n${line}\n`;
        })
        .join("\n");
};
