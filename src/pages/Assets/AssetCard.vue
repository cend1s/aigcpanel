<script setup lang="ts">
import AudioPlayer from "../../components/common/AudioPlayer.vue";
import type { AssetRecord } from "./assets";

// interactive=false 用于选择器：媒体不响应点击，点击交给外层用于勾选
withDefaults(defineProps<{ asset: AssetRecord; interactive?: boolean }>(), { interactive: true });
</script>

<template>
    <div class="h-36 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden flex items-center justify-center">
        <img
            v-if="asset.content.type === 'image'"
            :src="'file://' + asset.content.file"
            class="max-h-full max-w-full object-contain"
            loading="lazy"
        />
        <!-- 网格里可能一次显示几十个视频：用原生 video 只加载元数据，比完整播放器轻得多 -->
        <video
            v-else-if="asset.content.type === 'video'"
            :src="'file://' + asset.content.file"
            preload="metadata"
            :controls="interactive"
            muted
            class="max-h-full max-w-full"
            :class="interactive ? '' : 'pointer-events-none'"
        ></video>
        <div v-else-if="asset.content.type === 'audio'" class="w-full px-2" :class="interactive ? '' : 'pointer-events-none'">
            <AudioPlayer :url="'file://' + asset.content.file" />
        </div>
        <div v-else class="text-xs text-gray-600 p-2 self-start whitespace-pre-wrap line-clamp-6">{{ asset.content.text }}</div>
    </div>
</template>
