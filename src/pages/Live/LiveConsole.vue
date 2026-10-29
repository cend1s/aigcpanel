<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import PageHeader from "../../components/PageHeader.vue";
import { t } from "../../lang";
import { Dialog } from "../../lib/dialog";
import Router from "../../router";
import { VideoTemplateRecord, VideoTemplateService } from "../../service/VideoTemplateService";
import { LiveVoiceService, VoiceRecord } from "../../service/VoiceService";
import {
    STAGE_SIZES,
    liveApplySettings,
    liveCheck,
    liveRuntime,
    liveSay,
    liveStart,
    liveStop,
    liveViewerEvent,
    openStage,
} from "./runtime";
import { EventTypes } from "./util";

const s = liveRuntime.settings;
const voices = ref<VoiceRecord[]>([]);
const avatars = ref<VideoTemplateRecord[]>([]);
const problems = ref<string[]>([]);
const sayText = ref("");
const sim = ref({ type: "Comment", username: "小王", content: "这个多少钱" });
const now = ref(Date.now());
let clock: any = null;

const running = computed(() => liveRuntime.status === "running");
const busy = computed(() => liveRuntime.status === "starting" || liveRuntime.status === "stopping");
const duration = computed(() => {
    if (!liveRuntime.startedAt) return "";
    const sec = Math.max(0, Math.floor((now.value - liveRuntime.startedAt) / 1000));
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(Math.floor(sec / 3600))}:${p(Math.floor((sec % 3600) / 60))}:${p(sec % 60)}`;
});

const SOURCE_LABEL: Record<string, string> = {
    user: "live.kb.user",
    llm: "live.talkLlm",
    manual: "live.talkManual",
    system: "live.kb.system",
    flowTalk: "live.kb.flowTalk",
};
const SOURCE_COLOR: Record<string, string> = {
    user: "orangered",
    llm: "orangered",
    manual: "purple",
    system: "arcoblue",
    flowTalk: "green",
};
const STATUS_LABEL: Record<string, string> = {
    pending: "live.statusPending",
    synthesizing: "live.statusSynthesizing",
    waiting: "live.statusWaiting",
};

const refreshOptions = async () => {
    voices.value = await LiveVoiceService.list();
    avatars.value = await VideoTemplateService.list();
    problems.value = await liveCheck();
};

const doStart = async () => {
    problems.value = await liveCheck();
    if (problems.value.length) {
        Dialog.tipError(t("live.checkFailed"));
        return;
    }
    try {
        await liveStart();
        Dialog.tipSuccess(t("live.started"));
    } catch (e: any) {
        Dialog.tipError(String(e?.message ?? e));
    }
};

const doStop = async () => {
    await Dialog.confirm(t("live.stopConfirm"));
    await liveStop();
};

const doOpenStage = async () => {
    try {
        await openStage();
    } catch (e: any) {
        Dialog.tipError(String(e?.message ?? e));
    }
};

const doSay = () => {
    const r = liveSay(sayText.value);
    if (r.ok) {
        sayText.value = "";
    } else if (r.reason === "blackWord") {
        Dialog.tipError(t("live.kb.containsBlackWords", { words: (r as any).words.join("、") }));
    }
};

const doSimulate = async () => {
    await liveViewerEvent({ ...sim.value, source: "simulate" });
    Dialog.tipSuccess(t("live.simulateSent"));
};

// 设置改动后自动保存；直播中立即生效
let applyTimer: any = null;
watch(
    () => ({ ...s }),
    () => {
        clearTimeout(applyTimer);
        applyTimer = setTimeout(async () => {
            await liveApplySettings().catch((e) => Dialog.tipError(String(e?.message ?? e)));
            problems.value = await liveCheck();
        }, 400);
    },
);

onMounted(() => {
    refreshOptions();
    clock = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => clearInterval(clock));

const goTab = (tab: string) => Router.push({ path: "/live", query: { tab } });
</script>

<template>
    <div class="p-5">
        <PageHeader :title="$t('live.console')" :desc="$t('live.consoleDesc')" />

        <div class="rounded-xl border p-4 mb-4 flex items-center gap-3 bg-white">
            <a-button v-if="!running" type="primary" status="danger" size="large" :loading="busy" @click="doStart">
                <template #icon><icon-play-arrow /></template>
                {{ $t("live.start") }}
            </a-button>
            <a-button v-else size="large" :loading="busy" @click="doStop">
                <template #icon><icon-pause /></template>
                {{ $t("live.stop") }}
            </a-button>
            <div v-if="running" class="flex items-center gap-2">
                <span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
                <span class="font-bold text-red-500">{{ $t("live.onAir") }}</span>
                <span class="text-gray-500 font-mono">{{ duration }}</span>
            </div>
            <div class="flex-grow"></div>
            <a-button @click="doOpenStage">
                <template #icon><icon-desktop /></template>
                {{ $t("live.openStage") }}
            </a-button>
        </div>

        <a-alert v-if="!running && problems.length" type="warning" class="mb-4">
            <div v-for="p in problems" :key="p">· {{ $t(p) }}</div>
        </a-alert>

        <div class="flex gap-4 items-start">
            <!-- 设置 -->
            <div class="rounded-xl border p-4 bg-white" style="width: 400px; flex-shrink: 0">
                <a-form :model="s" layout="vertical" size="small">
                    <div class="font-bold mb-2">{{ $t("live.sectionVoice") }}</div>
                    <a-form-item :label="$t('live.voice')">
                        <a-select v-model="s.voiceId" :placeholder="$t('live.selectVoice')" @popup-visible-change="(v: boolean) => v && refreshOptions()">
                            <a-option v-for="v in voices" :key="v.id" :value="v.id">{{ v.title }}</a-option>
                        </a-select>
                        <template #extra>
                            <a-link size="small" @click="goTab('voice')">{{ $t("live.manageVoice") }}</a-link>
                        </template>
                    </a-form-item>

                    <div class="font-bold mb-2 mt-4">{{ $t("live.sectionStage") }}</div>
                    <a-form-item :label="$t('live.display')">
                        <a-radio-group v-model="s.display" type="button">
                            <a-radio value="avatar">{{ $t("live.displayAvatar") }}</a-radio>
                            <a-radio value="videos">{{ $t("live.displayVideos") }}</a-radio>
                        </a-radio-group>
                    </a-form-item>
                    <a-form-item v-if="s.display === 'avatar'" :label="$t('live.avatar')">
                        <a-select v-model="s.avatarId" :placeholder="$t('live.selectAvatar')" @popup-visible-change="(v: boolean) => v && refreshOptions()">
                            <a-option v-for="a in avatars" :key="a.id" :value="a.id">{{ a.name }}</a-option>
                        </a-select>
                        <template #extra>{{ $t("live.avatarLipHint") }}</template>
                    </a-form-item>
                    <a-form-item v-else :label="$t('live.videoSound')">
                        <a-switch v-model="s.videoSound" />
                        <template #extra>{{ $t("live.videoSoundHint") }}</template>
                    </a-form-item>
                    <div class="flex gap-4">
                        <a-form-item :label="$t('live.stageSize')" class="flex-grow">
                            <a-select v-model="s.stageSize">
                                <a-option v-for="z in STAGE_SIZES" :key="z.value" :value="z.value">{{ $t(z.labelKey) }}</a-option>
                            </a-select>
                        </a-form-item>
                        <a-form-item :label="$t('live.subtitle')" style="width: 80px">
                            <a-switch v-model="s.subtitle" />
                        </a-form-item>
                    </div>

                    <div class="font-bold mb-2 mt-4">{{ $t("live.sectionTalk") }}</div>
                    <a-form-item :label="$t('live.flowTalkMode')">
                        <a-radio-group v-model="s.flowTalkMode" type="button">
                            <a-radio value="order">{{ $t("live.order") }}</a-radio>
                            <a-radio value="random">{{ $t("live.random") }}</a-radio>
                        </a-radio-group>
                    </a-form-item>
                    <a-form-item :label="$t('live.flowTalkDelay')">
                        <a-input-number v-model="s.flowTalkDelayMin" :min="0" :max="600" style="width: 110px" />
                        <span class="mx-2">~</span>
                        <a-input-number v-model="s.flowTalkDelayMax" :min="0" :max="600" style="width: 110px" />
                        <span class="ml-2 text-gray-500">{{ $t("live.seconds") }}</span>
                    </a-form-item>
                    <div class="flex gap-4">
                        <a-form-item :label="$t('live.defaultUsername')" class="flex-grow">
                            <a-input v-model="s.defaultUsername" :max-length="10" />
                        </a-form-item>
                        <a-form-item :label="$t('live.enterIgnore')" class="flex-grow">
                            <a-input-number v-model="s.enterIgnoreSecond" :min="0" :max="3600">
                                <template #suffix>{{ $t("live.seconds") }}</template>
                            </a-input-number>
                        </a-form-item>
                    </div>
                </a-form>
            </div>

            <!-- 直播中 -->
            <div class="flex-grow min-w-0 space-y-4">
                <div class="rounded-xl border p-4 bg-white">
                    <div class="font-bold mb-2">{{ $t("live.nowPlaying") }}</div>
                    <div v-if="liveRuntime.current" class="flex items-start gap-2">
                        <a-tag :color="SOURCE_COLOR[liveRuntime.current.source]">{{ $t(SOURCE_LABEL[liveRuntime.current.source]) }}</a-tag>
                        <div class="flex-grow">
                            <div class="text-base">{{ liveRuntime.current.text }}</div>
                            <div v-if="liveRuntime.current.trigger" class="text-gray-400 text-xs mt-1">← {{ liveRuntime.current.trigger }}</div>
                        </div>
                    </div>
                    <div v-else class="text-gray-400">{{ running ? $t("live.idle") : $t("live.notStarted") }}</div>
                </div>

                <div class="rounded-xl border p-4 bg-white">
                    <div class="font-bold mb-2">{{ $t("live.manualSay") }}</div>
                    <div class="flex gap-2">
                        <a-textarea v-model="sayText" :auto-size="{ minRows: 1, maxRows: 3 }" :placeholder="$t('live.manualSayPlaceholder')" @keydown.enter.exact.prevent="doSay" />
                        <a-button type="primary" :disabled="!running || !sayText.trim()" @click="doSay">{{ $t("live.send") }}</a-button>
                    </div>
                </div>

                <div class="rounded-xl border p-4 bg-white">
                    <div class="font-bold mb-1">{{ $t("live.simulate") }}</div>
                    <div class="text-gray-400 text-xs mb-2">{{ $t("live.simulateDesc") }}</div>
                    <div class="flex gap-2">
                        <a-select v-model="sim.type" style="width: 120px">
                            <a-option v-for="e in EventTypes" :key="e.value" :value="e.value">{{ $t(e.labelKey) }}</a-option>
                        </a-select>
                        <a-input v-model="sim.username" :placeholder="$t('live.nickname')" style="width: 120px" />
                        <a-input v-if="sim.type === 'Comment'" v-model="sim.content" :placeholder="$t('live.commentContent')" />
                        <a-button :disabled="!running" @click="doSimulate">{{ $t("live.send") }}</a-button>
                    </div>
                </div>

                <div class="rounded-xl border p-4 bg-white">
                    <div class="font-bold mb-2">{{ $t("live.queue") }} <span class="text-gray-400 font-normal">{{ liveRuntime.queue.length }}</span></div>
                    <div v-if="!liveRuntime.queue.length" class="text-gray-400 text-sm">{{ $t("live.queueEmpty") }}</div>
                    <div v-for="i in liveRuntime.queue" :key="i.id" class="flex items-center gap-2 text-sm py-1">
                        <a-tag size="small" :color="SOURCE_COLOR[i.source]">{{ $t(SOURCE_LABEL[i.source]) }}</a-tag>
                        <span class="flex-grow truncate">{{ i.text }}</span>
                        <span class="text-gray-400 text-xs flex-shrink-0">{{ STATUS_LABEL[i.status] ? $t(STATUS_LABEL[i.status]) : "" }}</span>
                    </div>
                </div>

                <div v-if="liveRuntime.recent.length" class="rounded-xl border p-4 bg-white">
                    <div class="font-bold mb-2">{{ $t("live.recent") }}</div>
                    <div v-for="i in liveRuntime.recent.slice(0, 8)" :key="i.id" class="flex items-center gap-2 text-sm py-1">
                        <a-tag size="small" :color="SOURCE_COLOR[i.source]">{{ $t(SOURCE_LABEL[i.source]) }}</a-tag>
                        <span class="flex-grow truncate">{{ i.text }}</span>
                    </div>
                </div>

                <div v-if="liveRuntime.warns.length" class="rounded-xl border border-orange-200 p-4 bg-orange-50">
                    <div class="font-bold mb-2 text-orange-600">{{ $t("live.warns") }}</div>
                    <div v-for="(w, i) in liveRuntime.warns.slice(0, 6)" :key="i" class="text-sm text-orange-700 py-0.5">
                        <span class="text-orange-400 mr-2">{{ new Date(w.time).toLocaleTimeString() }}</span>{{ w.msg }}
                    </div>
                </div>

                <a-collapse :bordered="false">
                    <a-collapse-item :header="$t('live.howToTitle')" key="howto">
                        <ol class="list-decimal pl-5 text-sm leading-7 text-gray-600">
                            <li>{{ $t("live.howTo1") }}</li>
                            <li>{{ $t("live.howTo2") }}</li>
                            <li>{{ $t("live.howTo3") }}</li>
                            <li>{{ $t("live.howTo4") }}</li>
                        </ol>
                    </a-collapse-item>
                </a-collapse>
            </div>
        </div>
    </div>
</template>
