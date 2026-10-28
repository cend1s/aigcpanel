<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import PageHeader from "../../components/PageHeader.vue";
import { doOpenFile } from "../../components/common/util";
import { t } from "../../lang";
import { Dialog } from "../../lib/dialog";
import { AssetService } from "../../service/AssetService";
import AssetCard from "./AssetCard.vue";
import { AssetRecord, AssetType, collectTags, filterAssets, MEDIA_EXTENSIONS } from "./assets";

const assets = ref<AssetRecord[]>([]);
const type = ref<AssetType | "">("");
const tag = ref("");
const keyword = ref("");
const page = ref(1);
const PAGE_SIZE = 24;

const filtered = computed(() => filterAssets(assets.value, { type: type.value, tag: tag.value, keyword: keyword.value }));
const pageItems = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const tags = computed(() => collectTags(assets.value));
const TYPES: { value: AssetType | ""; label: string }[] = [
    { value: "", label: "assets.all" },
    { value: "video", label: "assets.video" },
    { value: "image", label: "assets.image" },
    { value: "audio", label: "assets.audio" },
    { value: "text", label: "assets.text" },
];
const countOf = (v: AssetType | "") => (v ? assets.value.filter((a) => a.content.type === v).length : assets.value.length);

const refresh = async () => {
    assets.value = await AssetService.list();
};
onMounted(refresh);

const doImportFiles = async () => {
    const r = await doOpenFile({ extensions: MEDIA_EXTENSIONS, multiple: true }).catch(() => undefined);
    if (!r) return;
    Dialog.loadingOn(t("assets.importing"));
    try {
        const res = await AssetService.importFiles(Array.isArray(r) ? r : [r], tag.value ? [tag.value] : []);
        Dialog.tipSuccess(t("assets.imported", { n: res.imported }));
        if (res.skipped.length) Dialog.tipError(t("assets.skipped", { n: res.skipped.length }));
    } finally {
        Dialog.loadingOff();
        await refresh();
    }
};

const doImportTasks = async () => {
    const n = await AssetService.importTaskResults();
    Dialog.tipSuccess(n ? t("assets.taskImported", { n }) : t("assets.taskNothing"));
    await refresh();
};

// 文本资产 / 编辑
const editing = ref<AssetRecord | null>(null);
const creatingText = ref(false);
const form = ref({ title: "", tags: "", note: "", text: "" });
const openText = () => {
    creatingText.value = true;
    editing.value = null;
    form.value = { title: "", tags: tag.value, note: "", text: "" };
};
const openEdit = (a: AssetRecord) => {
    creatingText.value = false;
    editing.value = a;
    form.value = { title: a.title, tags: a.content.tags.join(" "), note: a.content.note, text: a.content.text };
};
const doSave = async () => {
    if (creatingText.value) {
        if (!form.value.text.trim()) return Dialog.tipError(t("assets.textRequired"));
        await AssetService.addText(form.value.title, form.value.text, form.value.tags.split(/[,，、\s]+/));
    } else if (editing.value?.id) {
        await AssetService.update(editing.value.id, form.value);
    }
    creatingText.value = false;
    editing.value = null;
    await refresh();
};
const doDelete = async (a: AssetRecord) => {
    await Dialog.confirm(a.content.owned ? t("assets.deleteOwned") : t("assets.deleteRef"));
    await AssetService.remove(a);
    await refresh();
};
const doCopy = async (a: AssetRecord) => {
    await navigator.clipboard.writeText(a.content.text);
    Dialog.tipSuccess(t("common.copySuccess"));
};
const doOpen = (a: AssetRecord) => window.$mapi.app.openPath(a.content.file);
const fmtDuration = (s: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
</script>

<template>
    <div class="p-5">
        <PageHeader :title="$t('assets.title')" :desc="$t('assets.desc')">
            <template #actions>
                <a-button type="primary" data-action="import-files" @click="doImportFiles">{{ $t("assets.importFiles") }}</a-button>
                <a-button data-action="add-text" @click="openText">{{ $t("assets.addText") }}</a-button>
                <a-button data-action="import-tasks" @click="doImportTasks">{{ $t("assets.importTasks") }}</a-button>
            </template>
        </PageHeader>

        <div class="flex flex-wrap items-center gap-3 mb-3">
            <a-radio-group v-model="type" type="button" @change="page = 1">
                <a-radio v-for="x in TYPES" :key="x.value" :value="x.value">{{ $t(x.label) }} {{ countOf(x.value) }}</a-radio>
            </a-radio-group>
            <a-input-search v-model="keyword" :placeholder="$t('assets.search')" allow-clear :style="{ width: '240px' }" @input="page = 1" />
        </div>
        <div v-if="tags.length" class="flex flex-wrap gap-2 mb-4">
            <a-tag
                v-for="x in tags"
                :key="x.tag"
                checkable
                :checked="tag === x.tag"
                @check="tag = tag === x.tag ? '' : x.tag; page = 1"
            >
                {{ x.tag }} {{ x.count }}
            </a-tag>
        </div>

        <div v-if="pageItems.length" class="grid grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
            <div v-for="a in pageItems" :key="a.id" class="rounded-xl border p-2 hover:shadow-md flex flex-col" data-asset>
                <AssetCard :asset="a" />
                <div class="mt-2 text-sm font-bold truncate" :title="a.title">{{ a.title }}</div>
                <div class="text-xs text-gray-400 flex gap-2">
                    <span>{{ $t("assets." + a.content.type) }}</span>
                    <span v-if="a.content.duration">{{ fmtDuration(a.content.duration) }}</span>
                    <span v-if="a.content.source === 'task'">{{ $t("assets.fromTask") }}</span>
                </div>
                <div class="flex flex-wrap gap-1 mt-1 min-h-[22px]">
                    <a-tag v-for="x in a.content.tags" :key="x" size="small">{{ x }}</a-tag>
                </div>
                <div class="flex gap-1 mt-2 pt-2 border-t">
                    <a-button size="mini" @click="openEdit(a)">{{ $t("assets.edit") }}</a-button>
                    <a-button v-if="a.content.type === 'text'" size="mini" @click="doCopy(a)">{{ $t("common.copyText") }}</a-button>
                    <a-button v-else size="mini" @click="doOpen(a)">{{ $t("assets.open") }}</a-button>
                    <div class="flex-grow"></div>
                    <a-button size="mini" status="danger" @click="doDelete(a)">{{ $t("common.delete") }}</a-button>
                </div>
            </div>
        </div>
        <m-empty v-else />
        <div v-if="filtered.length > PAGE_SIZE" class="flex justify-end mt-4">
            <a-pagination v-model:current="page" :total="filtered.length" :page-size="PAGE_SIZE" simple />
        </div>

        <a-modal
            :visible="creatingText || !!editing"
            :title="creatingText ? $t('assets.addText') : $t('assets.edit')"
            @ok="doSave"
            @cancel="creatingText = false; editing = null"
        >
            <div class="mb-3">
                <div class="text-sm mb-1">{{ $t("assets.name") }}</div>
                <a-input v-model="form.title" :max-length="60" />
            </div>
            <div v-if="creatingText || editing?.content.type === 'text'" class="mb-3">
                <div class="text-sm mb-1">{{ $t("assets.content") }}</div>
                <a-textarea v-model="form.text" :auto-size="{ minRows: 5, maxRows: 12 }" />
            </div>
            <div class="mb-3">
                <div class="text-sm mb-1">{{ $t("assets.tags") }}</div>
                <a-input v-model="form.tags" :placeholder="$t('assets.tagsPlaceholder')" />
            </div>
            <div>
                <div class="text-sm mb-1">{{ $t("assets.note") }}</div>
                <a-input v-model="form.note" :max-length="500" />
            </div>
        </a-modal>
    </div>
</template>
