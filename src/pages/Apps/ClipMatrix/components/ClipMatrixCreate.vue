<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import FilesSelector from "../../../../components/common/FilesSelector.vue";
import { dataAutoSaveDraft } from "../../../../components/common/util";
import { t } from "../../../../lang";
import { Dialog } from "../../../../lib/dialog";
import { ffprobeGetMediaDuration } from "../../../../lib/ffprobe";
import { TaskRecord, TaskService } from "../../../../service/TaskService";
import SoundGenerateForm from "../../../Video/components/SoundGenerateForm.vue";
import { MAX_VARIANTS, maxUniqueCombos, planVariants, splitScripts } from "../plan";
import { Clip, RATIOS } from "../render";
import { ClipMatrixModelConfigType } from "../type";

const emit = defineEmits<{ submitted: [] }>();

const formData = ref({
    videos: [] as string[],
    scripts: "",
    count: 10,
    ratio: "9:16",
    clipsPerVideo: 3,
    jitter: true,
    mirror: true,
    subtitle: true,
});
const { clearDraft } = dataAutoSaveDraft("ClipMatrixCreate.formData", formData.value);

// 每个音色一个配音表单，可增删
const voiceKeys = ref<number[]>([1]);
let nextVoiceKey = 2;
const voiceForms = ref<Record<number, InstanceType<typeof SoundGenerateForm> | null>>({});
const addVoice = () => voiceKeys.value.push(nextVoiceKey++);
const removeVoice = (k: number) => {
    voiceKeys.value = voiceKeys.value.filter((x) => x !== k);
    delete voiceForms.value[k];
};

const scripts = computed(() => splitScripts(formData.value.scripts));
const maxUnique = computed(() =>
    formData.value.videos.length && scripts.value.length
        ? maxUniqueCombos({
              clipCount: formData.value.videos.length,
              scriptCount: scripts.value.length,
              voiceCount: voiceKeys.value.length,
              options: {
                  clipsPerVideo: Math.min(formData.value.clipsPerVideo, formData.value.videos.length),
                  jitter: formData.value.jitter,
                  mirror: formData.value.mirror,
              },
          })
        : 0,
);

const submitting = ref(false);

const doSubmit = async () => {
    if (formData.value.videos.length < 1) return Dialog.tipError(t("clipMatrix.needVideos"));
    if (scripts.value.length < 1) return Dialog.tipError(t("clipMatrix.needScripts"));
    const voices: SoundGenerateParamType[] = [];
    for (const k of voiceKeys.value) {
        const v = await voiceForms.value[k]?.getValue();
        if (!v) return; // 表单内部已提示
        voices.push(v);
    }
    if (voices.length < 1) return Dialog.tipError(t("clipMatrix.needVoices"));

    submitting.value = true;
    Dialog.loadingOn(t("clipMatrix.preparing"));
    try {
        // 读取素材时长，用于切分片段
        const clips: Clip[] = [];
        for (const path of formData.value.videos) {
            clips.push({ path, duration: await ffprobeGetMediaDuration(path) });
        }
        const { variants, exhausted } = planVariants({
            clipCount: clips.length,
            scriptCount: scripts.value.length,
            voiceCount: voices.length,
            count: formData.value.count,
            seed: Date.now() % 2147483647,
            options: {
                clipsPerVideo: formData.value.clipsPerVideo,
                jitter: formData.value.jitter,
                mirror: formData.value.mirror,
            },
        });
        const batchId = `${Date.now()}`;
        const batchTitle = `${t("clipMatrix.batch")} ${new Date().toLocaleString()}`;
        for (const variant of variants) {
            const modelConfig: ClipMatrixModelConfigType = {
                batchId,
                batchTitle,
                variant,
                clips,
                script: scripts.value[variant.scriptIndex],
                soundGenerate: voices[variant.voiceIndex],
                ratio: formData.value.ratio,
                subtitle: formData.value.subtitle,
            };
            const record: TaskRecord = {
                biz: "ClipMatrix",
                title: `${batchTitle} #${variant.index + 1}`,
                serverName: "",
                serverTitle: "",
                serverVersion: "",
                modelConfig,
                param: {},
            };
            await TaskService.submit(record);
        }
        Dialog.loadingOff();
        if (exhausted) {
            Dialog.tipError(t("clipMatrix.exhausted", { n: variants.length }));
        } else {
            Dialog.tipSuccess(t("clipMatrix.submitted", { n: variants.length }));
        }
        emit("submitted");
        clearDraft();
        await nextTick();
    } catch (e) {
        Dialog.loadingOff();
        Dialog.tipError(String(e));
    } finally {
        submitting.value = false;
    }
};
</script>

<template>
    <div class="rounded-xl shadow border p-4">
        <div class="mb-4">
            <div class="font-bold mb-2">1. {{ $t("clipMatrix.stepVideos") }}</div>
            <FilesSelector :extensions="['mp4', 'mov', 'mkv', 'avi', 'webm']" v-model="formData.videos" />
            <div class="text-xs text-gray-400 mt-1">{{ $t("clipMatrix.stepVideosHint") }}</div>
        </div>
        <div class="mb-4">
            <div class="font-bold mb-2">
                2. {{ $t("clipMatrix.stepScripts") }}
                <span class="text-gray-400 font-normal text-sm ml-2">{{ $t("clipMatrix.scriptCount", { n: scripts.length }) }}</span>
            </div>
            <a-textarea
                v-model="formData.scripts"
                :auto-size="{ minRows: 4, maxRows: 12 }"
                :placeholder="$t('clipMatrix.scriptsPlaceholder')"
            />
        </div>
        <div class="mb-4">
            <div class="font-bold mb-2">3. {{ $t("clipMatrix.stepVoices") }}</div>
            <div v-for="(k, i) in voiceKeys" :key="k" class="flex items-start gap-2 mb-2">
                <div class="pt-1 w-14 text-sm text-gray-500">{{ $t("clipMatrix.voice") }} {{ i + 1 }}</div>
                <div class="flex-grow">
                    <SoundGenerateForm :ref="(el: any) => (voiceForms[k] = el)" voice-select-only />
                </div>
                <a-button v-if="voiceKeys.length > 1" size="mini" status="danger" @click="removeVoice(k)">
                    {{ $t("common.delete") }}
                </a-button>
            </div>
            <a-button size="small" @click="addVoice">+ {{ $t("clipMatrix.addVoice") }}</a-button>
        </div>
        <div class="mb-4">
            <div class="font-bold mb-2">4. {{ $t("clipMatrix.stepOptions") }}</div>
            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div class="flex items-center gap-2 whitespace-nowrap">
                    {{ $t("clipMatrix.count") }}
                    <a-input-number v-model="formData.count" :min="1" :max="MAX_VARIANTS" :precision="0" :style="{ width: '100px' }" />
                </div>
                <div class="flex items-center gap-2 whitespace-nowrap">
                    {{ $t("clipMatrix.ratio") }}
                    <a-select v-model="formData.ratio" :style="{ width: '100px' }">
                        <a-option v-for="(_, r) in RATIOS" :key="r" :value="r">{{ r }}</a-option>
                    </a-select>
                </div>
                <div class="flex items-center gap-2 whitespace-nowrap">
                    {{ $t("clipMatrix.clipsPerVideo") }}
                    <a-input-number v-model="formData.clipsPerVideo" :min="1" :max="20" :precision="0" :style="{ width: '80px' }" />
                </div>
                <a-checkbox v-model="formData.jitter">{{ $t("clipMatrix.jitter") }}</a-checkbox>
                <a-checkbox v-model="formData.mirror">{{ $t("clipMatrix.mirror") }}</a-checkbox>
                <a-checkbox v-model="formData.subtitle">{{ $t("clipMatrix.subtitle") }}</a-checkbox>
            </div>
            <div v-if="maxUnique" class="text-xs mt-2" :class="maxUnique < formData.count ? 'text-orange-500' : 'text-gray-400'">
                {{ $t("clipMatrix.maxUnique", { n: maxUnique }) }}
            </div>
        </div>
        <a-button type="primary" :loading="submitting" data-action="submit" @click="doSubmit">
            <icon-send class="mr-2" />
            {{ $t("clipMatrix.submit") }}
        </a-button>
    </div>
</template>
