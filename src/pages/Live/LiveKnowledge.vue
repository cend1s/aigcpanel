<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useCheckAll } from "../../components/common/check-all";
import ListerTop from "../../components/common/ListerTop.vue";
import MEmpty from "../../components/common/MEmpty.vue";
import MLoading from "../../components/common/MLoading.vue";
import DataConfigDialogButton from "../../components/common/DataConfigDialogButton.vue";
import PageHeader from "../../components/PageHeader.vue";
import StorageBatchDeleteAction from "../../components/Server/StorageBatchDeleteAction.vue";
import VideoPlayer from "../../components/common/VideoPlayer.vue";
import { t } from "../../lang";
import { Dialog } from "../../lib/dialog";
import { StorageRecord, StorageService } from "../../service/StorageService";
import LiveBlackWordDialog from "./components/LiveBlackWordDialog.vue";
import LiveKnowledgeEditDialog from "./components/LiveKnowledgeEditDialog.vue";
import { LiveBlackWordContent } from "./config/blackWord";
import { EventTypes, KnowledgeType, KnowledgeTypes, parseKeywords, talksOf } from "./util";

const editDialog = ref<InstanceType<typeof LiveKnowledgeEditDialog>>();
const blackWordDialog = ref<InstanceType<typeof LiveBlackWordDialog>>();

const loading = ref(true);
const all = ref<StorageRecord[]>([]);
const type = ref<KnowledgeType>("flowTalk");
const page = ref(1);
const pageSize = 20;

const ofType = computed(() => all.value.filter((r) => r.content?.type === type.value));
const records = computed(() => ofType.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const countOf = (k: string) => all.value.filter((r) => r.content?.type === k).length;
const { isAllChecked, isIndeterminate, onCheckAll, checkRecords } = useCheckAll({ records });

watch(type, () => (page.value = 1));

const doRefresh = async () => {
    loading.value = true;
    all.value = (await StorageService.list("LiveKnowledge")).map((r) => ({ ...r, _check: false }));
    loading.value = false;
};

const doToggle = async (r: StorageRecord, enable: boolean) => {
    await StorageService.update(r.id!, { content: { ...r.content, enable } });
    r.content.enable = enable;
};

const doDelete = async (r: StorageRecord) => {
    await Dialog.confirm(t("common.deleteConfirm"));
    await StorageService.delete(r);
    await doRefresh();
};

const eventLabelKey = (v: string) => EventTypes.find((e) => e.value === v)?.labelKey ?? "";

onMounted(doRefresh);
</script>

<template>
    <div class="p-5">
        <PageHeader :title="$t('live.knowledge')" :desc="$t('live.kb.desc')" />
        <div class="mb-3">
            <a-radio-group v-model="type" type="button">
                <a-radio v-for="k in KnowledgeTypes" :key="k.value" :value="k.value">
                    {{ $t(k.labelKey) }}
                    <span class="text-gray-400 text-xs ml-1">{{ countOf(k.value) }}</span>
                </a-radio>
            </a-radio-group>
            <div class="text-gray-400 text-sm mt-2">{{ $t(KnowledgeTypes.find((k) => k.value === type)!.descKey) }}</div>
        </div>
        <ListerTop :loading="loading" :total="ofType.length" @refresh="doRefresh">
            <template #actions>
                <DataConfigDialogButton
                    :title="$t('live.kb.blackWordConfig')"
                    name="LiveBlackWordContent"
                    :help="$t('live.kb.blackWordConfigHelp')"
                    :default-value="LiveBlackWordContent"
                />
                <a-button @click="blackWordDialog?.show(all)">
                    <template #icon><icon-exclamation-circle /></template>
                    {{ $t("live.kb.censor") }}
                </a-button>
                <a-button type="primary" @click="editDialog?.show(type)">
                    <template #icon><icon-plus /></template>
                    {{ $t("common.add") }}
                </a-button>
            </template>
        </ListerTop>

        <div v-if="loading"><m-loading /></div>
        <div v-else-if="!ofType.length" class="py-20"><m-empty :text="$t('live.kb.empty')" /></div>
        <template v-else>
            <div class="flex items-center mb-3">
                <a-checkbox :model-value="isAllChecked" :indeterminate="isIndeterminate" @change="onCheckAll" class="mr-3">
                    {{ $t("common.selectAll") }}
                </a-checkbox>
                <StorageBatchDeleteAction :records="checkRecords" @update="doRefresh" />
                <div class="flex-grow"></div>
                <a-pagination v-if="ofType.length > pageSize" v-model:current="page" :total="ofType.length" :page-size="pageSize" simple />
            </div>
            <div v-for="r in records" :key="r.id" class="rounded-xl shadow border p-4 mb-3 hover:shadow-lg bg-white" :class="r.content.enable === false ? 'opacity-60' : ''">
                <div class="flex items-center gap-2">
                    <a-checkbox v-model="r['_check']" />
                    <div class="inline-flex items-center bg-blue-100 rounded-full px-3 h-8">
                        <span class="truncate" style="max-width: 360px">{{ r.title }}</span>
                    </div>
                    <a-tag v-if="r.content.type === 'system'" color="arcoblue">{{ $t(eventLabelKey(r.content.systemType)) }}</a-tag>
                    <template v-if="r.content.type === 'user'">
                        <a-tag v-for="kw in parseKeywords(r.content.keywords)" :key="kw" color="orangered">{{ kw }}</a-tag>
                    </template>
                    <div class="flex-grow"></div>
                    <a-switch size="small" :model-value="r.content.enable !== false" @change="(v: any) => doToggle(r, !!v)" />
                    <a-button size="mini" @click="editDialog?.show(type, r)">
                        <template #icon><icon-edit /></template>
                    </a-button>
                    <a-button size="mini" @click="doDelete(r)">
                        <template #icon><icon-delete /></template>
                    </a-button>
                </div>
                <div v-if="r.content.type === 'flowVideo'" class="mt-3" style="max-width: 360px">
                    <VideoPlayer :url="r.content.url" />
                </div>
                <div v-else class="mt-3 space-y-1">
                    <div v-for="(talk, i) in talksOf(r.content)" :key="i" class="flex items-start text-sm leading-6">
                        <icon-robot class="mr-2 mt-1 flex-shrink-0 text-gray-400" />
                        <span>{{ talk }}</span>
                    </div>
                </div>
            </div>
        </template>

        <LiveKnowledgeEditDialog ref="editDialog" @update="doRefresh" />
        <LiveBlackWordDialog ref="blackWordDialog" @edit="(r) => editDialog?.show(r.content.type, r)" />
    </div>
</template>
