<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useCheckAll } from "../../components/common/check-all";
import ListerTop from "../../components/common/ListerTop.vue";
import MEmpty from "../../components/common/MEmpty.vue";
import MLoading from "../../components/common/MLoading.vue";
import PageHeader from "../../components/PageHeader.vue";
import StorageBatchDeleteAction from "../../components/Server/StorageBatchDeleteAction.vue";
import { t } from "../../lang";
import { Dialog } from "../../lib/dialog";
import { StorageRecord, StorageService } from "../../service/StorageService";

// 播报历史（LiveTalk）：title 为来源（flowTalk/user/system/manual/llm），content 为 { content, username?, trigger? }
const SOURCES = [
    { value: "flowTalk", labelKey: "live.kb.flowTalk" },
    { value: "user", labelKey: "live.kb.user" },
    { value: "system", labelKey: "live.kb.system" },
    { value: "manual", labelKey: "live.talkManual" },
    { value: "llm", labelKey: "live.talkLlm" },
];

const loading = ref(true);
const all = ref<StorageRecord[]>([]);
const source = ref("");
const page = ref(1);
const pageSize = 50;

const filtered = computed(() => all.value.filter((r) => !source.value || r.title === source.value));
const records = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const { isAllChecked, isIndeterminate, onCheckAll, checkRecords } = useCheckAll({ records });
watch(source, () => (page.value = 1));

const labelKeyOf = (v?: string) => SOURCES.find((s) => s.value === v)?.labelKey;

const doRefresh = async () => {
    loading.value = true;
    all.value = (await StorageService.list("LiveTalk")).map((r) => ({ ...r, _check: false }));
    loading.value = false;
};

const doClear = async () => {
    await Dialog.confirm(t("common.clearConfirm"));
    await StorageService.clear("LiveTalk");
    await doRefresh();
};

onMounted(doRefresh);
</script>

<template>
    <div class="p-5">
        <PageHeader :title="$t('live.talkHistory')" :desc="$t('live.talkHistoryDesc')" />
        <ListerTop :loading="loading" :total="filtered.length" @refresh="doRefresh">
            <a-radio-group v-model="source" type="button">
                <a-radio value="">{{ $t("common.all") }}</a-radio>
                <a-radio v-for="s in SOURCES" :key="s.value" :value="s.value">{{ $t(s.labelKey) }}</a-radio>
            </a-radio-group>
            <template #actions>
                <a-button status="danger" :disabled="!all.length" @click="doClear">
                    <template #icon><icon-delete /></template>
                    {{ $t("common.clear") }}
                </a-button>
            </template>
        </ListerTop>
        <div v-if="loading"><m-loading /></div>
        <div v-else-if="!filtered.length" class="py-20"><m-empty :text="$t('live.talkEmpty')" /></div>
        <template v-else>
            <div class="flex items-center mb-3">
                <a-checkbox :model-value="isAllChecked" :indeterminate="isIndeterminate" @change="onCheckAll" class="mr-3">
                    {{ $t("common.selectAll") }}
                </a-checkbox>
                <StorageBatchDeleteAction :records="checkRecords" @update="doRefresh" />
                <div class="flex-grow"></div>
                <a-pagination v-if="filtered.length > pageSize" v-model:current="page" :total="filtered.length" :page-size="pageSize" simple />
            </div>
            <div v-for="r in records" :key="r.id" class="rounded-xl border p-3 mb-2 bg-white">
                <div class="flex items-center gap-2">
                    <a-checkbox v-model="r['_check']" />
                    <a-tag color="green">{{ labelKeyOf(r.title) ? $t(labelKeyOf(r.title)!) : r.title }}</a-tag>
                    <span v-if="r.content?.trigger" class="text-gray-500 text-sm truncate" style="max-width: 50%">← {{ r.content.trigger }}</span>
                    <span class="text-gray-400 text-sm"><timeago :datetime="r['createdAt'] * 1000" /></span>
                </div>
                <div class="mt-2 ml-6">{{ r.content?.content }}</div>
            </div>
        </template>
    </div>
</template>
