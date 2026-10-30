// 直播引擎核心：排队、合成、播放、循环口播、互动回复。
// 不依赖界面与 Electron，合成与播放等副作用都通过 deps 注入，便于单元测试。
import { findBlackWords } from "./config/blackWord";
import { matchUserKnowledge, renderTalk, talksOf } from "./util";

export type TalkSource = "user" | "llm" | "manual" | "system" | "flowTalk";

/** 数值越大越先播：弹幕回复 > 手动插播 > 系统事件 > 循环口播 */
export const TALK_PRIORITY: Record<TalkSource, number> = {
    user: 40,
    llm: 40,
    manual: 30,
    system: 20,
    flowTalk: 10,
};

/** 每类最多排队几条，超出时丢弃最早的（观众的新问题比旧问题更值得回答） */
const PENDING_LIMIT: Record<TalkSource, number> = {
    user: 3,
    llm: 2,
    manual: 20,
    system: 2,
    flowTalk: 1,
};

export type TalkStatus = "pending" | "synthesizing" | "waiting" | "playing" | "done" | "failed";

export type TalkItem = {
    id: string;
    source: TalkSource;
    text: string;
    trigger?: string;
    priority: number;
    status: TalkStatus;
    audio?: string;
    error?: string;
    createdAt: number;
    /** 循环口播的最早播放时间，用来在两句之间留出间隔 */
    notBefore?: number;
};

export type KnowledgeRecord = {
    id?: number;
    title?: string;
    content: {
        enable?: boolean;
        type?: string;
        systemType?: string;
        keywords?: string;
        reply?: string;
        replies?: { value?: string }[];
        url?: string;
    };
};

export type LiveEngineConfig = {
    flowTalkMode: "order" | "random";
    /** 两句循环口播之间的间隔（秒） */
    flowTalkDelayMin: number;
    flowTalkDelayMax: number;
    /** 取不到昵称时的称呼 */
    defaultUsername: string;
    /** 同一观众多久内重复进入不再欢迎（秒） */
    enterIgnoreSecond: number;
    /** 评论没命中关键词时用大模型回复 */
    llmEnabled: boolean;
    /** 两次大模型回复之间的最短间隔（秒）：评论很密时只挑着回，也控制调用成本 */
    llmCooldownSecond: number;
    /** 等待大模型回复的最长时间（秒），超时放弃，免得回复过时 */
    llmTimeoutSecond: number;
};

export const DEFAULT_ENGINE_CONFIG: LiveEngineConfig = {
    flowTalkMode: "order",
    flowTalkDelayMin: 3,
    flowTalkDelayMax: 8,
    defaultUsername: "宝子",
    enterIgnoreSecond: 120,
    llmEnabled: false,
    llmCooldownSecond: 8,
    llmTimeoutSecond: 15,
};

/** 同类系统事件的全局冷却（毫秒）：点赞等事件很密集，避免刷屏式播报 */
const SYSTEM_COOLDOWN: Record<string, number> = {
    Enter: 8_000,
    Like: 30_000,
    Follow: 10_000,
    Gift: 5_000,
};

export type LiveViewerEvent = {
    type: string;
    username?: string;
    content?: string;
};

export type LiveEngineDeps = {
    /** 合成语音，返回本地音频路径 */
    synthesize: (text: string) => Promise<string>;
    /** 播放音频，播放结束后 resolve */
    play: (item: TalkItem) => Promise<void>;
    /** 播放完的音频可以清理 */
    release?: (item: TalkItem) => Promise<void>;
    /** 大模型回复：返回要播报的话，空串表示不回复；抛异常会被记为提示 */
    chat?: (comment: string, username: string, knowledge: KnowledgeRecord[]) => Promise<string>;
    blackWords: () => string[];
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    random: () => number;
    /** 播报完成（写播报历史） */
    onTalked?: (item: TalkItem) => void;
    /** 合成或播放失败、话术被违禁词拦截等 */
    onWarn?: (msg: string, item?: TalkItem) => void;
    /** 状态变化（界面刷新） */
    onChange?: () => void;
};

let seq = 0;
const newId = () => `t${Date.now().toString(36)}${(++seq).toString(36)}`;

export class LiveEngine {
    running = false;
    queue: TalkItem[] = [];
    current: TalkItem | null = null;
    config: LiveEngineConfig = { ...DEFAULT_ENGINE_CONFIG };
    private knowledge: KnowledgeRecord[] = [];
    private flowIndex = 0;
    private lastFlowId: number | undefined;
    private lastTalkOf = new Map<number, string>();
    private enterAt = new Map<string, number>();
    private systemAt = new Map<string, number>();
    private llmBusy = false;
    private llmAt = 0;
    private loops: Promise<void>[] = [];

    constructor(private deps: LiveEngineDeps) {}

    setConfig(config: Partial<LiveEngineConfig>) {
        this.config = { ...this.config, ...config };
    }

    setKnowledge(records: KnowledgeRecord[]) {
        this.knowledge = records.filter((r) => r.content?.enable !== false);
    }

    get flowTalks() {
        return this.knowledge.filter((r) => r.content.type === "flowTalk" && talksOf(r.content).length);
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.loops = [this.synthLoop(), this.playLoop()];
        this.changed();
    }

    async stop() {
        this.running = false;
        const unplayed = this.queue.filter((i) => i.audio && i.status !== "playing");
        this.queue = [];
        this.changed();
        await Promise.all(this.loops);
        for (const item of unplayed) {
            await this.deps.release?.(item).catch(() => undefined);
        }
        this.loops = [];
        this.current = null;
        this.changed();
    }

    /** 手动插播 */
    say(text: string, source: TalkSource = "manual", trigger?: string) {
        const clean = String(text ?? "").trim();
        if (!clean) return { ok: false, reason: "empty" as const };
        const bad = this.blackWordsIn(clean);
        if (bad.length) {
            this.deps.onWarn?.(`含违禁词「${bad.join("、")}」，已跳过：${clean}`);
            return { ok: false, reason: "blackWord" as const, words: bad };
        }
        this.enqueue(source, clean, trigger);
        return { ok: true as const };
    }

    /** 观众互动：评论走关键词回复，其余走系统事件 */
    onEvent(e: LiveViewerEvent) {
        if (!this.running) return;
        const username = String(e.username ?? "").trim();
        const vars = { username, defaultUsername: this.config.defaultUsername };
        const trigger = `${username || this.config.defaultUsername}${e.content ? `：${e.content}` : ""}`;
        if (e.type === "Comment") {
            const hit = matchUserKnowledge(String(e.content ?? ""), this.knowledge);
            if (!hit) {
                void this.askLlm(String(e.content ?? ""), username, trigger);
                return;
            }
            const talk = this.pickTalk(hit, vars);
            if (talk) this.enqueue("user", talk, trigger);
            return;
        }
        const now = this.deps.now();
        if (e.type === "Enter" && username) {
            const last = this.enterAt.get(username);
            if (last && now - last < this.config.enterIgnoreSecond * 1000) return;
            this.enterAt.set(username, now);
        }
        const cooldown = SYSTEM_COOLDOWN[e.type] ?? 10_000;
        const lastAt = this.systemAt.get(e.type);
        if (lastAt !== undefined && now - lastAt < cooldown) return;
        const candidates = this.knowledge.filter(
            (r) => r.content.type === "system" && r.content.systemType === e.type && talksOf(r.content).length,
        );
        if (!candidates.length) return;
        const record = candidates[Math.floor(this.deps.random() * candidates.length)];
        const talk = this.pickTalk(record, vars);
        if (!talk) return;
        this.systemAt.set(e.type, now);
        this.enqueue("system", talk, trigger);
    }

    // ── 内部 ────────────────────────────────────────────

    /** 评论没命中关键词：交给大模型。同一时间只处理一条，间隔内的评论直接忽略 */
    private async askLlm(comment: string, username: string, trigger: string) {
        const { chat } = this.deps;
        const text = comment.trim();
        if (!this.config.llmEnabled || !chat || text.length < 2) return;
        const now = this.deps.now();
        if (this.llmBusy || now - this.llmAt < this.config.llmCooldownSecond * 1000) return;
        this.llmBusy = true;
        this.llmAt = now;
        try {
            let timer: any;
            const reply = await Promise.race([
                chat(text, username || this.config.defaultUsername, this.knowledge),
                new Promise<string>((_r, reject) => {
                    timer = setTimeout(() => reject(new Error("大模型回复超时")), this.config.llmTimeoutSecond * 1000);
                }),
            ]).finally(() => clearTimeout(timer));
            if (!this.running) return;
            const clean = String(reply ?? "").trim();
            if (!clean) return;
            const bad = this.blackWordsIn(clean);
            if (bad.length) {
                this.deps.onWarn?.(`大模型回复含违禁词「${bad.join("、")}」，已丢弃：${clean}`);
                return;
            }
            this.enqueue("llm", clean, trigger);
        } catch (e: any) {
            this.deps.onWarn?.(`大模型回复失败：${String(e?.message ?? e)}`);
        } finally {
            this.llmBusy = false;
        }
    }

    private changed() {
        this.deps.onChange?.();
    }

    private blackWordsIn(text: string) {
        return Array.from(new Set(findBlackWords(text, this.deps.blackWords()).map((v) => v.word)));
    }

    /** 从一条知识里挑一句不含违禁词的话术；有多句时避免和上次重复 */
    private pickTalk(record: KnowledgeRecord, vars: { username?: string; defaultUsername?: string }) {
        const all = talksOf(record.content).map((t) => renderTalk(t, vars));
        const clean = all.filter((t) => !this.blackWordsIn(t).length);
        if (!clean.length) {
            this.deps.onWarn?.(`「${record.title || all[0] || ""}」的话术都含违禁词，已跳过`);
            return "";
        }
        const key = record.id ?? -1;
        const last = this.lastTalkOf.get(key);
        const choices = clean.length > 1 ? clean.filter((t) => t !== last) : clean;
        const talk = choices[Math.floor(this.deps.random() * choices.length)];
        this.lastTalkOf.set(key, talk);
        return talk;
    }

    private enqueue(source: TalkSource, text: string, trigger?: string, notBefore?: number) {
        const pending = this.queue.filter((i) => i.source === source && i.status !== "playing");
        if (pending.length >= PENDING_LIMIT[source]) {
            const drop = pending[0];
            this.queue = this.queue.filter((i) => i !== drop);
        }
        const item: TalkItem = {
            id: newId(),
            source,
            text,
            trigger,
            priority: TALK_PRIORITY[source],
            status: "pending",
            createdAt: this.deps.now(),
            notBefore,
        };
        this.queue.push(item);
        this.changed();
        return item;
    }

    /** 排序：优先级高的在前，同级先来先播 */
    private ordered(status: TalkStatus) {
        return this.queue
            .filter((i) => i.status === status)
            .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    }

    private async synthLoop() {
        while (this.running) {
            const item = this.ordered("pending")[0];
            if (!item) {
                await this.deps.sleep(100);
                continue;
            }
            item.status = "synthesizing";
            this.changed();
            try {
                item.audio = await this.deps.synthesize(item.text);
                item.status = "waiting";
            } catch (e: any) {
                item.status = "failed";
                item.error = String(e?.message ?? e);
                this.queue = this.queue.filter((i) => i !== item);
                this.deps.onWarn?.(`语音合成失败：${item.error}`, item);
            }
            this.changed();
        }
    }

    private nextFlowTalk() {
        const list = this.flowTalks;
        if (!list.length) return null;
        let record: KnowledgeRecord;
        if (this.config.flowTalkMode === "random" && list.length > 1) {
            const others = list.filter((r) => r.id !== this.lastFlowId);
            record = others[Math.floor(this.deps.random() * others.length)];
        } else {
            record = list[this.flowIndex % list.length];
            this.flowIndex = (this.flowIndex + 1) % list.length;
        }
        this.lastFlowId = record.id;
        return this.pickTalk(record, { defaultUsername: this.config.defaultUsername });
    }

    private flowDelay() {
        const min = Math.max(0, Number(this.config.flowTalkDelayMin) || 0);
        const max = Math.max(min, Number(this.config.flowTalkDelayMax) || 0);
        return (min + this.deps.random() * (max - min)) * 1000;
    }

    private async playLoop() {
        let lastEnd = 0;
        while (this.running) {
            const now = this.deps.now();
            const ready = this.ordered("waiting").filter((i) => !i.notBefore || i.notBefore <= now);
            const item = ready[0];
            if (!item) {
                // 没有互动、也没有待播内容时，提前准备下一句循环口播（合成需要时间）
                const idle = !this.queue.some((i) => i.source !== "flowTalk");
                if (idle && !this.queue.some((i) => i.source === "flowTalk")) {
                    const talk = this.nextFlowTalk();
                    if (talk) this.enqueue("flowTalk", talk, undefined, (lastEnd || now) + (lastEnd ? this.flowDelay() : 0));
                }
                await this.deps.sleep(100);
                continue;
            }
            item.status = "playing";
            this.current = item;
            this.changed();
            try {
                await this.deps.play(item);
                item.status = "done";
                this.deps.onTalked?.(item);
            } catch (e: any) {
                item.status = "failed";
                item.error = String(e?.message ?? e);
                this.deps.onWarn?.(`播放失败：${item.error}`, item);
            }
            this.queue = this.queue.filter((i) => i !== item);
            this.current = null;
            lastEnd = this.deps.now();
            await this.deps.release?.(item).catch(() => undefined);
            this.changed();
        }
    }
}
