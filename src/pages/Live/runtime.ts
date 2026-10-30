// 直播运行时：把直播引擎接到软件里（直播音色合成、直播画面窗口、播报历史、互动记录）。
// 单例，切换页面不影响正在进行的直播。
import { reactive } from "vue";
import { StorageUtil } from "../../lib/storage";
import { StorageService } from "../../service/StorageService";
import { VideoTemplateService } from "../../service/VideoTemplateService";
import { LiveVoiceService } from "../../service/VoiceService";
import { loadBlackWords } from "./config/blackWord";
import { buildKnowledgeContext, cleanLlmReply, fillLlmPrompt, LiveLlmReplyPrompt, LiveLlmReplySystemPrompt } from "./config/llmReply";
import { getDataContent } from "../../components/common/dataConfig";
import { useModelStore } from "../../module/Model/store/model";
import { buildDouyinMonitorScript, normalizeDouyinRoomUrl } from "./douyin";
import { DEFAULT_ENGINE_CONFIG, KnowledgeRecord, LiveEngine, LiveViewerEvent, TalkItem } from "./engine";

const STAGE = "live-stage";
const SETTINGS_KEY = "LiveConsoleSettings";

export const STAGE_SIZES = [
    { value: "720x1280", labelKey: "live.sizePortrait" },
    { value: "1280x720", labelKey: "live.sizeLandscape" },
    { value: "1080x1080", labelKey: "live.sizeSquare" },
];

export type LiveConsoleSettings = {
    voiceId: number;
    display: "avatar" | "videos";
    avatarId: number;
    stageSize: string;
    subtitle: boolean;
    videoSound: boolean;
    flowTalkMode: "order" | "random";
    flowTalkDelayMin: number;
    flowTalkDelayMax: number;
    defaultUsername: string;
    enterIgnoreSecond: number;
    /** 抖音直播间地址 */
    liveRoomUrl: string;
    /** 评论没命中关键词时用大模型回复（需要在设置里配置大模型） */
    llmEnabled: boolean;
    /** 大模型，格式「供应商id|模型id」 */
    llmModel: string;
    llmCooldownSecond: number;
};

const DEFAULT_SETTINGS: LiveConsoleSettings = {
    voiceId: 0,
    display: "avatar",
    avatarId: 0,
    stageSize: "720x1280",
    subtitle: true,
    videoSound: false,
    flowTalkMode: DEFAULT_ENGINE_CONFIG.flowTalkMode,
    flowTalkDelayMin: DEFAULT_ENGINE_CONFIG.flowTalkDelayMin,
    flowTalkDelayMax: DEFAULT_ENGINE_CONFIG.flowTalkDelayMax,
    defaultUsername: DEFAULT_ENGINE_CONFIG.defaultUsername,
    enterIgnoreSecond: DEFAULT_ENGINE_CONFIG.enterIgnoreSecond,
    liveRoomUrl: "",
    llmEnabled: false,
    llmModel: "",
    llmCooldownSecond: DEFAULT_ENGINE_CONFIG.llmCooldownSecond,
};

export const liveRuntime = reactive({
    settings: { ...DEFAULT_SETTINGS, ...(StorageUtil.get(SETTINGS_KEY, {}) as Partial<LiveConsoleSettings>) },
    status: "stopped" as "stopped" | "starting" | "running" | "stopping",
    startedAt: 0,
    current: null as TalkItem | null,
    queue: [] as TalkItem[],
    recent: [] as TalkItem[],
    warns: [] as { time: number; msg: string }[],
    /** 弹幕监听：本次打开后收到的互动数与最近一条 */
    monitorOpened: false,
    monitorCount: 0,
    monitorLast: null as null | { type: string; username: string; content: string; time: number },
});

export const saveLiveSettings = () => StorageUtil.set(SETTINGS_KEY, liveRuntime.settings);

const warn = (msg: string) => {
    liveRuntime.warns.unshift({ time: Date.now(), msg });
    liveRuntime.warns.splice(30);
};

const stageSize = () => {
    const [w, h] = liveRuntime.settings.stageSize.split("x").map(Number);
    // 窗口按一半大小打开，直播伴侣采集时会按画布缩放；需要更清晰可以手动拉大窗口
    return { width: Math.round((w || 720) / 2), height: Math.round((h || 1280) / 2) };
};

// 按创建顺序：「顺序」播报时先建的先播
const loadKnowledge = async () =>
    ((await StorageService.list("LiveKnowledge")) as KnowledgeRecord[]).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

/** 打开（或找回）直播画面窗口并下发画面配置 */
export const openStage = async () => {
    const s = liveRuntime.settings;
    await window.$mapi.app.windowOpen(STAGE, { singleton: false, ...stageSize() });
    const knowledge = await loadKnowledge();
    const videos = knowledge
        .filter((r) => r.content?.type === "flowVideo" && r.content?.enable !== false && r.content?.url)
        .map((r) => r.content.url as string);
    const avatar = s.avatarId ? await VideoTemplateService.get(s.avatarId) : null;
    const res = await window.$mapi.event.callPage(STAGE, "LiveStageConfig", {
        display: s.display,
        avatarVideo: avatar?.video || "",
        videos,
        subtitle: s.subtitle,
        videoSound: s.videoSound,
    });
    if (res.code) throw new Error(res.msg || "直播画面窗口没有响应");
};

const engine = new LiveEngine({
    synthesize: async (text) => {
        const voice = await LiveVoiceService.get(liveRuntime.settings.voiceId);
        if (!voice) throw new Error("请先选择直播音色");
        return await LiveVoiceService.synthesize(voice, text);
    },
    play: async (item) => {
        const call = () =>
            window.$mapi.event.callPage(STAGE, "LiveStagePlay", { audio: item.audio, text: item.text }, { timeout: 10 * 60 * 1000 });
        let res = await call();
        // 直播画面窗口被关掉了：重新打开再播一次
        if (res.code && /send failed/.test(res.msg || "")) {
            await openStage();
            res = await call();
        }
        if (res.code) throw new Error(res.msg || "播放失败");
    },
    release: async (item) => {
        if (item.audio) await window.$mapi.file.deletes(item.audio);
    },
    chat: async (comment, username, knowledge) => {
        const [providerId, modelId] = (liveRuntime.settings.llmModel || "|").split("|");
        const tpl = await getDataContent("LiveLlmReplyPrompt", LiveLlmReplyPrompt);
        const system = await getDataContent("LiveLlmReplyPromptSystem", LiveLlmReplySystemPrompt);
        const prompt = fillLlmPrompt(tpl, { knowledge: buildKnowledgeContext(knowledge), username, comment });
        const ret = await useModelStore().chat(providerId, modelId, prompt, { systemPrompt: system });
        if (ret.code) throw new Error(ret.msg || "大模型调用失败");
        return cleanLlmReply(ret.data?.content ?? "");
    },
    blackWords: () => blackWords,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    random: () => Math.random(),
    onTalked: (item) => {
        liveRuntime.recent.unshift({ ...item });
        liveRuntime.recent.splice(20);
        StorageService.add("LiveTalk", { title: item.source, content: { content: item.text, trigger: item.trigger || "" } });
    },
    onWarn: (msg) => warn(msg),
    onChange: () => {
        liveRuntime.current = engine.current ? { ...engine.current } : null;
        // 按实际播放顺序展示：优先级高的在前，同级先来先播
        liveRuntime.queue = engine.queue
            .filter((i) => i.status !== "playing")
            .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
            .map((i) => ({ ...i }));
    },
});

let blackWords: string[] = [];
let knowledgeTimer: any = null;

const applyEngineSettings = () => {
    const s = liveRuntime.settings;
    engine.setConfig({
        flowTalkMode: s.flowTalkMode,
        flowTalkDelayMin: s.flowTalkDelayMin,
        flowTalkDelayMax: s.flowTalkDelayMax,
        defaultUsername: s.defaultUsername,
        enterIgnoreSecond: s.enterIgnoreSecond,
        llmEnabled: s.llmEnabled && !!s.llmModel,
        llmCooldownSecond: s.llmCooldownSecond,
    });
};

/** 开播前检查，返回问题列表（空表示可以开播） */
export const liveCheck = async () => {
    const s = liveRuntime.settings;
    const problems: string[] = [];
    if (!s.voiceId || !(await LiveVoiceService.get(s.voiceId))) problems.push("live.checkVoice");
    const knowledge = await loadKnowledge();
    const enabled = knowledge.filter((r) => r.content?.enable !== false);
    if (!enabled.some((r) => r.content?.type === "flowTalk")) problems.push("live.checkFlowTalk");
    if (s.display === "avatar" && !s.avatarId) problems.push("live.checkAvatar");
    if (s.display === "videos" && !enabled.some((r) => r.content?.type === "flowVideo")) problems.push("live.checkVideos");
    if (s.llmEnabled && !s.llmModel) problems.push("live.checkLlmModel");
    return problems;
};

export const liveStart = async () => {
    if (liveRuntime.status !== "stopped") return;
    liveRuntime.status = "starting";
    try {
        saveLiveSettings();
        blackWords = await loadBlackWords();
        applyEngineSettings();
        engine.setKnowledge(await loadKnowledge());
        await openStage();
        engine.start();
        liveRuntime.status = "running";
        liveRuntime.startedAt = Date.now();
        // 直播中改了知识库也能生效
        knowledgeTimer = setInterval(async () => {
            engine.setKnowledge(await loadKnowledge());
            blackWords = await loadBlackWords();
        }, 15_000);
    } catch (e) {
        liveRuntime.status = "stopped";
        throw e;
    }
};

export const liveStop = async () => {
    if (liveRuntime.status !== "running") return;
    liveRuntime.status = "stopping";
    clearInterval(knowledgeTimer);
    await window.$mapi.event.callPage(STAGE, "LiveStageStop", {}, { timeout: 3000 }).catch(() => undefined);
    await engine.stop();
    liveRuntime.status = "stopped";
    liveRuntime.startedAt = 0;
};

/** 直播中修改了设置：引擎参数立即生效，画面配置重新下发 */
export const liveApplySettings = async () => {
    saveLiveSettings();
    applyEngineSettings();
    if (liveRuntime.status === "running") await openStage();
};

export const liveSay = (text: string) => engine.say(text, "manual");

/** 观众互动：记入「直播互动」，并交给引擎回复（弹幕监听和控制台的模拟互动都走这里） */
export const liveViewerEvent = async (e: LiveViewerEvent & { source?: string }) => {
    await StorageService.add("LiveEvent", {
        title: e.type,
        content: { source: e.source || "", username: e.username || "", content: e.content || "" },
    });
    engine.onEvent(e);
};

// ── 抖音弹幕监听 ─────────────────────────────────────────

const MONITOR = "monitor";
let monitorListening = false;

const onMonitorEvent = (d: any) => {
    const data = d?.data ?? {};
    liveRuntime.monitorCount++;
    liveRuntime.monitorLast = { type: d?.type, username: data.username || "", content: data.content || "", time: Date.now() };
    liveViewerEvent({ type: d?.type, username: data.username, content: data.content, source: data.source || "douyin" }).catch(() => undefined);
};

/** 打开抖音直播间监听窗口；同一时间只有一个，换地址时重新打开 */
export const monitorOpen = async (input: string) => {
    const url = normalizeDouyinRoomUrl(input);
    if (!url) throw new Error("请填写抖音直播间地址，例如 https://live.douyin.com/123456789");
    liveRuntime.settings.liveRoomUrl = url;
    saveLiveSettings();
    if (!monitorListening) {
        window.__page.onBroadcast("MonitorEvent", onMonitorEvent);
        monitorListening = true;
    }
    if (liveRuntime.monitorOpened) {
        await window.$mapi.app.windowClose(MONITOR).catch(() => undefined);
        // 关闭是异步的，等旧窗口真正关掉，否则会直接把旧窗口重新显示出来
        await new Promise((r) => setTimeout(r, 500));
    }
    await window.$mapi.app.windowOpen(MONITOR, {
        title: "抖音直播间弹幕监听",
        width: 1100,
        height: 800,
        url,
        scriptContent: buildDouyinMonitorScript(),
        openDevTools: false,
        broadcastPages: ["main"],
    });
    liveRuntime.monitorOpened = true;
    liveRuntime.monitorCount = 0;
    liveRuntime.monitorLast = null;
};

export const monitorClose = async () => {
    await window.$mapi.app.windowClose(MONITOR).catch(() => undefined);
    liveRuntime.monitorOpened = false;
};
