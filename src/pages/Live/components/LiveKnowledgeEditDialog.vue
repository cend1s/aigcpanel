<script setup lang="ts">
import { computed, ref } from "vue";
import FileSelector from "../../../components/common/FileSelector.vue";
import { t } from "../../../lang";
import { Dialog } from "../../../lib/dialog";
import ModelGenerateButton, {
    ModelGenerateButtonOptionType,
} from "../../../module/Model/ModelGenerateButton.vue";
import { StorageRecord, StorageService } from "../../../service/StorageService";
import { findBlackWords, loadBlackWords } from "../config/blackWord";
import { LiveReplyGenerateContent } from "../config/replyGenerate";
import {
    KnowledgeType,
    KnowledgeTypes,
    SystemEventTypes,
    joinKeywords,
    parseGeneratedTalks,
    parseKeywords,
    talksOf,
    talksToContent,
} from "../util";

const emit = defineEmits<{ update: [] }>();

const visible = ref(false);
const saving = ref(false);
const editId = ref(0);
const blackWords = ref<string[]>([]);

const form = ref({
    type: "flowTalk" as KnowledgeType,
    title: "",
    enable: true,
    keywords: [] as string[],
    systemType: "Enter" as string,
    talks: [""] as string[],
    url: "",
});

const typeInfo = computed(() => KnowledgeTypes.find((k) => k.value === form.value.type)!);
const isVideo = computed(() => form.value.type === "flowVideo");

const show = async (type: KnowledgeType, record?: StorageRecord) => {
    blackWords.value = await loadBlackWords();
    editId.value = record?.id ?? 0;
    const c = record?.content ?? {};
    const talks = talksOf(c);
    form.value = {
        type: (c.type as KnowledgeType) ?? type,
        title: record?.title ?? "",
        enable: c.enable !== false,
        keywords: parseKeywords(c.keywords),
        systemType: c.systemType || "Enter",
        talks: talks.length ? talks : [""],
        url: c.url ?? "",
    };
    visible.value = true;
};

const addTalk = () => form.value.talks.push("");
const removeTalk = (i: number) => {
    form.value.talks.splice(i, 1);
    if (!form.value.talks.length) form.value.talks.push("");
};

const violationsOf = (text: string) => findBlackWords(text, blackWords.value).map((v) => v.word);

const aiCount = ref(5);
const aiOption: ModelGenerateButtonOptionType = {
    mode: "once",
    promptDefault: LiveReplyGenerateContent,
    promptSystem: "",
    onGetParam: async () => {
        const base = form.value.talks.find((s) => s.trim());
        if (!base) {
            Dialog.tipError(t("live.kb.aiNeedFirstTalk"));
            return null;
        }
        return { reply: base.trim(), count: aiCount.value };
    },
    onResult: async (result: string) => {
        const generated = parseGeneratedTalks(result);
        if (!generated.length) {
            Dialog.tipError(t("live.kb.aiEmpty"));
            return;
        }
        const existing = new Set(form.value.talks.map((s) => s.trim()));
        const fresh = generated.filter((s) => !existing.has(s));
        form.value.talks = [...form.value.talks.filter((s) => s.trim()), ...fresh];
        Dialog.tipSuccess(t("live.kb.aiAdded", { count: fresh.length }));
    },
};

const doSave = async () => {
    const f = form.value;
    const talks = f.talks.map((s) => s.trim()).filter(Boolean);
    if (!isVideo.value && !talks.length) {
        Dialog.tipError(t("live.kb.talkRequired"));
        return;
    }
    if (f.type === "user" && !f.keywords.length) {
        Dialog.tipError(t("live.kb.keywordRequired"));
        return;
    }
    if (isVideo.value && !f.url) {
        Dialog.tipError(t("live.kb.videoRequired"));
        return;
    }
    saving.value = true;
    try {
        let url = f.url;
        // 循环视频复制到应用数据目录，原文件被移动或删除也不影响直播
        if (isVideo.value && url) {
            url = await window.$mapi.file.hubSave(url, { ignoreWhenInHub: true });
        }
        const title =
            f.title.trim() ||
            (f.type === "user" ? f.keywords.join("、") : (talks[0] || "").slice(0, 20)) ||
            t(typeInfo.value.labelKey);
        const content = {
            enable: f.enable,
            type: f.type,
            systemType: f.type === "system" ? f.systemType : "",
            tags: [],
            keywords: f.type === "user" ? joinKeywords(f.keywords) : "",
            ...talksToContent(isVideo.value ? [] : talks),
            url: isVideo.value ? url : "",
        };
        await StorageService.addOrUpdate("LiveKnowledge", editId.value, { title, content });
        visible.value = false;
        emit("update");
    } catch (e) {
        Dialog.tipError(String(e));
    } finally {
        saving.value = false;
    }
};

defineExpose({ show });
</script>

<template>
    <a-modal
        v-model:visible="visible"
        width="760px"
        title-align="start"
        :title="(editId ? $t('common.edit') : $t('common.add')) + ' · ' + $t(typeInfo.labelKey)"
        :ok-loading="saving"
        :ok-text="$t('common.save')"
        @before-ok="(done: any) => (doSave(), done(false))"
    >
        <div class="text-gray-400 text-sm mb-4">{{ $t(typeInfo.descKey) }}</div>
        <a-form :model="form" layout="vertical">
            <div class="flex gap-4">
                <a-form-item :label="$t('live.kb.title')" class="flex-grow">
                    <a-input v-model="form.title" :placeholder="$t('live.kb.titlePlaceholder')" :max-length="50" />
                </a-form-item>
                <a-form-item :label="$t('common.enable')" style="width: 80px">
                    <a-switch v-model="form.enable" />
                </a-form-item>
            </div>

            <a-form-item v-if="form.type === 'user'" :label="$t('live.kb.keywords')" required>
                <a-input-tag
                    v-model="form.keywords"
                    allow-clear
                    :placeholder="$t('live.kb.keywordsPlaceholder')"
                />
                <template #extra>{{ $t("live.kb.keywordsHelp") }}</template>
            </a-form-item>

            <a-form-item v-if="form.type === 'system'" :label="$t('live.kb.systemType')" required>
                <a-radio-group v-model="form.systemType" type="button">
                    <a-radio v-for="e in SystemEventTypes" :key="e.value" :value="e.value">
                        {{ $t(e.labelKey) }}
                    </a-radio>
                </a-radio-group>
            </a-form-item>

            <a-form-item v-if="isVideo" :label="$t('live.kb.video')" required>
                <FileSelector v-model="form.url" :extensions="['mp4', 'mov', 'webm', 'mkv']" />
                <template #extra>{{ $t("live.kb.videoHelp") }}</template>
            </a-form-item>

            <a-form-item v-else :label="$t('live.kb.talks')" required>
                <template #extra>
                    {{ form.type === "flowTalk" ? $t("live.kb.talksHelpFlow") : $t("live.kb.talksHelp") }}
                    <span v-if="form.type !== 'flowTalk'">{{ $t("live.kb.usernameHelp") }}</span>
                </template>
                <div class="w-full">
                    <div v-for="(talk, i) in form.talks" :key="i" class="mb-2">
                        <div class="flex items-start gap-2">
                            <div class="text-gray-400 text-xs pt-2 w-6 flex-shrink-0">{{ i + 1 }}</div>
                            <a-textarea
                                v-model="form.talks[i]"
                                :auto-size="{ minRows: 1, maxRows: 4 }"
                                :placeholder="i === 0 ? $t('live.kb.talkPlaceholder') : $t('live.kb.talkAltPlaceholder')"
                            />
                            <a-button size="small" @click="removeTalk(i)">
                                <template #icon><icon-minus /></template>
                            </a-button>
                        </div>
                        <div v-if="violationsOf(talk).length" class="text-xs text-red-500 ml-8 mt-1">
                            {{ $t("live.kb.containsBlackWords", { words: violationsOf(talk).join("、") }) }}
                        </div>
                    </div>
                    <div class="flex items-center gap-2 ml-8">
                        <a-button size="small" @click="addTalk">
                            <template #icon><icon-plus /></template>
                            {{ $t("live.kb.addTalk") }}
                        </a-button>
                        <ModelGenerateButton biz="LiveReplyGenerateContent" :title="$t('live.kb.aiExpand')" :option="aiOption" />
                        <a-input-number v-model="aiCount" :min="1" :max="20" size="small" style="width: 110px">
                            <template #suffix>{{ $t("live.kb.aiCountUnit") }}</template>
                        </a-input-number>
                    </div>
                </div>
            </a-form-item>
        </a-form>
    </a-modal>
</template>
