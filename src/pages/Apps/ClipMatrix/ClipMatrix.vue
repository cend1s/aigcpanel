<script setup lang="ts">
import { onMounted } from "vue";
import PageHeader from "../../../components/PageHeader.vue";
import TaskBatchDeleteAction from "../../../components/Server/TaskBatchDeleteAction.vue";
import TaskBatchDownloadAction from "../../../components/Server/TaskBatchDownloadAction.vue";
import TaskCancelAction from "../../../components/Server/TaskCancelAction.vue";
import TaskDeleteAction from "../../../components/Server/TaskDeleteAction.vue";
import TaskDownloadAction from "../../../components/Server/TaskDownloadAction.vue";
import TaskDuration from "../../../components/Server/TaskDuration.vue";
import TextTruncateView from "../../../components/TextTruncateView.vue";
import ListerTop from "../../../components/common/ListerTop.vue";
import MEmpty from "../../../components/common/MEmpty.vue";
import TaskBizStatus from "../../../components/common/TaskBizStatus.vue";
import VideoPlayer from "../../../components/common/VideoPlayer.vue";
import { useCheckAll } from "../../../components/common/check-all";
import { usePaginate } from "../../../hooks/paginate";
import { useTaskChangeRefresh } from "../../../hooks/task";
import { TaskRecord, TaskService } from "../../../service/TaskService";
import ClipMatrixCreate from "./components/ClipMatrixCreate.vue";

const { page, records, recordsForPage } = usePaginate<TaskRecord>({ pageSize: 12 });
const { mergeCheck, isIndeterminate, isAllChecked, onCheckAll, checkRecords } = useCheckAll({
    records: recordsForPage,
});

const doRefresh = async () => {
    records.value = mergeCheck(await TaskService.list("ClipMatrix"));
};
useTaskChangeRefresh("ClipMatrix", () => setTimeout(doRefresh, 500));
onMounted(doRefresh);

const STEP_LABEL: Record<string, string> = {
    Audio: "clipMatrix.stepAudio",
    Render: "clipMatrix.stepRender",
    Subtitle: "clipMatrix.stepSubtitle",
    End: "clipMatrix.stepEnd",
};
</script>

<template>
    <div class="p-5">
        <PageHeader :title="$t('clipMatrix.title')" :desc="$t('clipMatrix.desc')" />
        <ClipMatrixCreate @submitted="doRefresh" />
        <ListerTop class="mt-4" :total="records.length" @refresh="doRefresh">
            <a-checkbox :model-value="isAllChecked" :indeterminate="isIndeterminate" @change="onCheckAll">
                {{ $t("common.selectAll") }}
            </a-checkbox>
            <TaskBatchDeleteAction :records="checkRecords" @update="doRefresh" />
            <TaskBatchDownloadAction :records="checkRecords" />
            <template #actions>
                <a-pagination v-model:current="page" :total="records.length" :page-size="12" show-total simple />
            </template>
        </ListerTop>
        <div v-if="records.length > 0" class="grid grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
            <div v-for="r in recordsForPage" :key="r.id" class="rounded-xl shadow border p-3 hover:shadow-lg flex flex-col">
                <div class="flex items-center gap-1 mb-2">
                    <a-checkbox v-model="r['_check']" />
                    <div class="font-bold truncate flex-grow">{{ r.title }}</div>
                    <TaskBizStatus :status="r.status" :status-msg="r.statusMsg" />
                </div>
                <div class="flex gap-3">
                    <div class="w-28 h-48 flex-shrink-0 rounded bg-gray-200 overflow-hidden flex items-center justify-center">
                        <VideoPlayer v-if="r.status === 'success' && r.result?.url" :url="'file://' + r.result.url" />
                        <div v-else class="text-xs text-gray-500 px-2 text-center">
                            {{ $t(STEP_LABEL[r.jobResult?.step] || "clipMatrix.stepAudio") }}
                        </div>
                    </div>
                    <div class="min-w-0 text-xs text-gray-500 space-y-1">
                        <div class="bg-gray-100 rounded p-2 text-gray-700">
                            <TextTruncateView :text="r.modelConfig.script" />
                        </div>
                        <div>{{ $t("clipMatrix.voice") }} {{ r.modelConfig.variant.voiceIndex + 1 }} · {{ r.modelConfig.ratio }}</div>
                        <div>{{ $t("clipMatrix.clipsUsed") }} {{ r.modelConfig.variant.clipOrder.map((i: number) => i + 1).join("→") }}</div>
                        <div>
                            {{ $t("clipMatrix.speed") }} {{ r.modelConfig.variant.speed }}x
                            <span v-if="r.modelConfig.variant.mirror"> · {{ $t("clipMatrix.mirror") }}</span>
                            <span v-if="r.modelConfig.subtitle"> · {{ $t("clipMatrix.subtitle") }}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center mt-2 pt-2 border-t">
                    <TaskDuration :start="r.startTime" :end="r.endTime" class="text-xs" />
                    <div class="flex-grow"></div>
                    <TaskDownloadAction :record="r" />
                    <TaskDeleteAction :record="r" @update="doRefresh" />
                    <TaskCancelAction :record="r" />
                </div>
            </div>
        </div>
        <m-empty v-else />
    </div>
</template>
