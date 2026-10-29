<script setup lang="ts">
import { ref } from "vue";
import { StorageRecord } from "../../../service/StorageService";
import { findBlackWords, highlightBlackWordsHtml, loadBlackWords } from "../config/blackWord";
import { talksOf } from "../util";

type Violation = {
    id: number;
    title: string;
    words: string[];
    talks: string[];
};

const emit = defineEmits<{ edit: [record: StorageRecord] }>();

const visible = ref(false);
const words = ref<string[]>([]);
const violations = ref<Violation[]>([]);
const recordMap = new Map<number, StorageRecord>();

const show = async (records: StorageRecord[]) => {
    words.value = await loadBlackWords();
    recordMap.clear();
    violations.value = [];
    for (const r of records) {
        const texts = [r.title || "", r.content?.keywords || "", ...talksOf(r.content || {})];
        const found = Array.from(new Set(texts.flatMap((s) => findBlackWords(s, words.value).map((v) => v.word))));
        if (found.length) {
            recordMap.set(r.id!, r);
            violations.value.push({ id: r.id!, title: r.title || "", words: found, talks: talksOf(r.content || {}) });
        }
    }
    visible.value = true;
};

const doEdit = (id: number) => {
    const r = recordMap.get(id);
    if (r) {
        visible.value = false;
        emit("edit", r);
    }
};

defineExpose({ show });
</script>

<template>
    <a-modal v-model:visible="visible" width="800px" :footer="false" title-align="start">
        <template #title>
            <icon-exclamation-circle class="text-red-500 mr-2" />
            {{ $t("live.kb.censorTitle") }}
            <span class="ml-3 text-sm text-gray-500">{{ $t("live.kb.censorCount", { count: violations.length }) }}</span>
        </template>
        <div style="max-height: 70vh" class="overflow-y-auto">
            <div v-if="!violations.length" class="text-center py-16">
                <icon-check-circle class="text-green-500 text-6xl mb-4" />
                <div class="text-lg font-bold text-green-600 mb-1">{{ $t("live.kb.censorPassTitle") }}</div>
                <div class="text-gray-500">{{ $t("live.kb.censorPassDesc") }}</div>
            </div>
            <template v-else>
                <a-alert type="warning" class="mb-3">{{ $t("live.kb.censorWarn") }}</a-alert>
                <div v-for="v in violations" :key="v.id" class="border border-red-200 rounded-lg p-3 mb-2 bg-red-50">
                    <div class="flex items-center mb-2">
                        <div class="font-bold flex-grow" v-html="highlightBlackWordsHtml(v.title, words)"></div>
                        <a-tag color="red" class="mr-2">{{ v.words.join("、") }}</a-tag>
                        <a-button size="mini" @click="doEdit(v.id)">
                            <template #icon><icon-edit /></template>
                            {{ $t("common.edit") }}
                        </a-button>
                    </div>
                    <div v-for="(talk, i) in v.talks" :key="i" class="text-sm leading-6" v-html="highlightBlackWordsHtml(talk, words)"></div>
                </div>
            </template>
        </div>
    </a-modal>
</template>

<style scoped>
:deep(.live-black-word) {
    background-color: rgb(254 202 202);
    color: rgb(153 27 27);
    padding: 0 0.2rem;
    border-radius: 0.25rem;
}
</style>
