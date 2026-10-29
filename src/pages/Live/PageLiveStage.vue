<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { toFileUrl } from "./util";

// 直播画面窗口：抖音直播伴侣用「窗口采集」采这个窗口、用「系统声音」采语音。
// 画面上不放任何按钮和标题栏，保证采集到的是干净画面。
export type LiveStageConfig = {
    /** avatar：循环播放形象视频；videos：轮播循环内容视频 */
    display: "avatar" | "videos";
    avatarVideo?: string;
    videos?: string[];
    subtitle?: boolean;
    /** 商品视频是否保留原声（默认静音，避免和播报语音混在一起） */
    videoSound?: boolean;
};

const config = ref<LiveStageConfig>({ display: "avatar", videos: [], subtitle: false });
const subtitle = ref("");
const videoIndex = ref(0);
const videoEl = ref<HTMLVideoElement | null>(null);
const audio = new Audio();

const videoSrc = computed(() => {
    const c = config.value;
    if (c.display === "videos" && c.videos?.length) {
        return toFileUrl(c.videos[videoIndex.value % c.videos.length]);
    }
    return c.avatarVideo ? toFileUrl(c.avatarVideo) : "";
});
const loopSingle = computed(() => config.value.display !== "videos" || (config.value.videos?.length ?? 0) <= 1);

const onVideoEnded = () => {
    if (!loopSingle.value) videoIndex.value++;
};

let finishCurrent: ((err?: string) => void) | null = null;

const stopAudio = () => {
    audio.pause();
    audio.removeAttribute("src");
    subtitle.value = "";
    finishCurrent?.("stopped");
    finishCurrent = null;
};

onMounted(() => {
    window.__page.registerCallPage("LiveStageConfig", (resolve, _reject, data: LiveStageConfig) => {
        config.value = { ...config.value, ...data };
        videoIndex.value = 0;
        resolve(true);
    });
    // 播放一段语音，播完才返回，直播引擎据此排下一句
    window.__page.registerCallPage("LiveStagePlay", (resolve, reject, data: { audio: string; text: string }) => {
        stopAudio();
        subtitle.value = data.text || "";
        finishCurrent = (err) => {
            subtitle.value = "";
            err ? reject(err) : resolve(true);
        };
        audio.onended = () => {
            finishCurrent?.();
            finishCurrent = null;
        };
        audio.onerror = () => {
            finishCurrent?.("音频无法播放");
            finishCurrent = null;
        };
        audio.src = toFileUrl(data.audio);
        audio.play().catch((e) => {
            finishCurrent?.(String(e?.message ?? e));
            finishCurrent = null;
        });
    });
    window.__page.registerCallPage("LiveStageStop", (resolve) => {
        stopAudio();
        resolve(true);
    });
});
</script>

<template>
    <div class="stage">
        <video
            v-if="videoSrc"
            ref="videoEl"
            :key="videoSrc"
            class="stage-video"
            :src="videoSrc"
            autoplay
            :muted="!(config.display === 'videos' && config.videoSound)"
            :loop="loopSingle"
            @ended="onVideoEnded"
        ></video>
        <div v-else class="stage-empty">{{ $t("live.stageEmpty") }}</div>
        <div v-if="config.subtitle && subtitle" class="stage-subtitle">{{ subtitle }}</div>
    </div>
</template>

<style scoped>
.stage {
    position: fixed;
    inset: 0;
    background: #000;
    overflow: hidden;
    user-select: none;
}
.stage-video {
    width: 100%;
    height: 100%;
    object-fit: contain;
}
.stage-empty {
    color: #666;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-size: 16px;
}
.stage-subtitle {
    position: absolute;
    left: 6%;
    right: 6%;
    bottom: 8%;
    text-align: center;
    color: #fff;
    font-size: clamp(16px, 4.2vw, 40px);
    font-weight: 600;
    line-height: 1.4;
    text-shadow: 0 0 4px #000, 0 2px 6px #000;
}
</style>
