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
import { EventTypes } from "./util";

// 观众互动记录（LiveEvent）：title 为事件类型，content 为 { source, username, content }
const loading = ref(true);
const all = ref<StorageRecord[]>([]);
const type = ref("");
const page = ref(1);
const pageSize = 50;

const filtered = computed(() => all.value.filter((r) => !type.value || r.title === type.value));
const records = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const { isAllChecked, isIndeterminate, onCheckAll, checkRecords } = useCheckAll({ records });
watch(type, () => (page.value = 1));

const labelKeyOf = (v?: string) => EventTypes.find((e) => e.value === v)?.labelKey;

const doRefresh = async () => {
    loading.value = true;
    all.value = (await StorageService.list("LiveEvent")).map((r) => ({ ...r, _check: false }));
    loading.value = false;
};

const doClear = async () => {
    await Dialog.confirm(t("common.clearConfirm"));
    await StorageService.clear("LiveEvent");
    await doRefresh();
};

onMounted(doRefresh);
</script>

<template>
    <div class="p-5">
        <PageHeader :title="$t('live.event')" :desc="$t('live.eventDesc')" />
        <ListerTop :loading="loading" :total="filtered.length" @refresh="doRefresh">
            <a-radio-group v-model="type" type="button">
                <a-radio value="">{{ $t("common.all") }}</a-radio>
                <a-radio v-for="e in EventTypes" :key="e.value" :value="e.value">{{ $t(e.labelKey) }}</a-radio>
            </a-radio-group>
            <template #actions>
                <a-button status="danger" :disabled="!all.length" @click="doClear">
                    <template #icon><icon-delete /></template>
                    {{ $t("common.clear") }}
                </a-button>
            </template>
        </ListerTop>
        <div v-if="loading"><m-loading /></div>
        <div v-else-if="!filtered.length" class="py-20"><m-empty :text="$t('live.eventEmpty')" /></div>
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
                    <a-tag color="arcoblue">{{ labelKeyOf(r.title) ? $t(labelKeyOf(r.title)!) : r.title }}</a-tag>
                    <span class="font-bold">{{ r.content?.username || "-" }}</span>
                    <span class="text-gray-400 text-sm"><timeago :datetime="r['createdAt'] * 1000" /></span>
                </div>
                <div v-if="r.content?.content" class="mt-2 ml-6">{{ r.content.content }}</div>
            </div>
        </template>
    </div>
</template>
