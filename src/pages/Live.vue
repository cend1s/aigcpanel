<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import VoiceManage from "../components/Voice/VoiceManage.vue";
import Router from "../router";
import { LiveVoiceService } from "../service/VoiceService";
import LiveConsole from "./Live/LiveConsole.vue";
import LiveEvent from "./Live/LiveEvent.vue";
import LiveKnowledge from "./Live/LiveKnowledge.vue";
import LiveTalk from "./Live/LiveTalk.vue";
import VideoTemplate from "./Video/VideoTemplate.vue";

const LIVE_TABS = [
    { value: "console", labelKey: "live.console", icon: "console", color: "text-red-500" },
    { value: "avatar", labelKey: "live.avatar", icon: "avatar", color: "text-blue-500" },
    { value: "voice", labelKey: "live.voice", icon: "voice", color: "text-indigo-500" },
    { value: "knowledge", labelKey: "live.knowledge", icon: "knowledge", color: "text-amber-500" },
    { value: "event", labelKey: "live.event", icon: "event", color: "text-green-500" },
    { value: "talk", labelKey: "live.talkHistory", icon: "talk", color: "text-violet-500" },
] as const;

const tab = ref("knowledge");

const syncTab = () => {
    const next = Router.currentRoute.value.query.tab as string;
    tab.value = LIVE_TABS.some((x) => x.value === next) ? next : "console";
};

// 选中的标签同步到地址栏，刷新或从别处跳转回来时保持一致
const selectTab = (next: string) => {
    tab.value = next;
    if (Router.currentRoute.value.query.tab !== next) {
        Router.push({ path: "/live", query: { tab: next } }).catch(() => {});
    }
};

onMounted(syncTab);
watch(() => Router.currentRoute.value.query.tab, syncTab);
</script>

<template>
    <div class="pb-device-container bg-white h-full relative select-none flex">
        <div class="p-6 w-52 flex-shrink-0 border-r border-solid border-gray-100 overflow-x-hidden overflow-y-auto">
            <div
                v-for="item in LIVE_TABS"
                :key="item.value"
                class="p-2 rounded-lg mb-2 cursor-pointer"
                :class="tab === item.value ? 'menu-item-active' : ''"
                @click="selectTab(item.value)"
            >
                <div class="text-base truncate flex items-center">
                    <i-mdi-broadcast v-if="item.icon === 'console'" class="w-5 h-5 inline-block mr-1" :class="item.color" />
                    <i-mdi-account-box v-else-if="item.icon === 'avatar'" class="w-5 h-5 inline-block mr-1" :class="item.color" />
                    <i-mdi-microphone v-else-if="item.icon === 'voice'" class="w-5 h-5 inline-block mr-1" :class="item.color" />
                    <i-mdi-book-open-variant v-else-if="item.icon === 'knowledge'" class="w-5 h-5 inline-block mr-1" :class="item.color" />
                    <i-mdi-message-processing v-else-if="item.icon === 'event'" class="w-5 h-5 inline-block mr-1" :class="item.color" />
                    <i-mdi-history v-else class="w-5 h-5 inline-block mr-1" :class="item.color" />
                    {{ $t(item.labelKey) }}
                </div>
            </div>
        </div>
        <div class="flex-grow h-full overflow-y-auto">
            <LiveConsole v-if="tab === 'console'" />
            <VideoTemplate v-else-if="tab === 'avatar'" />
            <VoiceManage
                v-else-if="tab === 'voice'"
                :service="LiveVoiceService"
                title-key="live.voice"
                desc-key="live.voiceDesc"
                test-prefix="LiveVoice"
            />
            <LiveKnowledge v-else-if="tab === 'knowledge'" />
            <LiveEvent v-else-if="tab === 'event'" />
            <LiveTalk v-else-if="tab === 'talk'" />
        </div>
    </div>
</template>
