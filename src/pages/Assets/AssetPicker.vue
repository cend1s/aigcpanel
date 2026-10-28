<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AssetService } from "../../service/AssetService";
import AssetCard from "./AssetCard.vue";
import { AssetRecord, AssetType, collectTags, filterAssets } from "./assets";

// 从资产中心多选素材：剪辑矩阵等功能复用
const props = defineProps<{ visible: boolean; type: AssetType }>();
const emit = defineEmits<{ "update:visible": [boolean]; select: [AssetRecord[]] }>();

const assets = ref<AssetRecord[]>([]);
const tag = ref("");
const keyword = ref("");
const selected = ref<Set<number>>(new Set());

watch(
    () => props.visible,
    async (v) => {
        if (!v) return;
        selected.value = new Set();
        assets.value = (await AssetService.list()).filter((a) => a.content.type === props.type);
    },
);
const list = computed(() => filterAssets(assets.value, { tag: tag.value, keyword: keyword.value }));
const tags = computed(() => collectTags(assets.value));
const toggle = (a: AssetRecord) => {
    const s = new Set(selected.value);
    s.has(a.id!) ? s.delete(a.id!) : s.add(a.id!);
    selected.value = s;
};
const confirm = () => {
    emit("select", assets.value.filter((a) => selected.value.has(a.id!)));
    emit("update:visible", false);
};
</script>

<template>
    <a-modal
        :visible="visible"
        width="900px"
        :title="$t('assets.pick')"
        :ok-text="$t('assets.pickConfirm', { n: selected.size })"
        :ok-button-props="{ disabled: selected.size === 0 }"
        @ok="confirm"
        @cancel="emit('update:visible', false)"
    >
        <div class="flex flex-wrap gap-2 mb-3 items-center">
            <a-input-search v-model="keyword" allow-clear :style="{ width: '200px' }" :placeholder="$t('assets.search')" />
            <a-tag v-for="x in tags" :key="x.tag" checkable :checked="tag === x.tag" @check="tag = tag === x.tag ? '' : x.tag">
                {{ x.tag }}
            </a-tag>
        </div>
        <div v-if="list.length" class="grid grid-cols-4 gap-3 max-h-[55vh] overflow-y-auto">
            <div
                v-for="a in list"
                :key="a.id"
                class="rounded-lg border-2 p-1 cursor-pointer"
                :class="selected.has(a.id!) ? 'border-blue-500' : 'border-transparent'"
                data-pick
                @click="toggle(a)"
            >
                <AssetCard :asset="a" :interactive="false" />
                <div class="text-xs mt-1 truncate">{{ a.title }}</div>
            </div>
        </div>
        <m-empty v-else :text="$t('assets.pickEmpty')" />
    </a-modal>
</template>
