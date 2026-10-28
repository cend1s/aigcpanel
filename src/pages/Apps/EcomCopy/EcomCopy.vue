<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import PageHeader from "../../../components/PageHeader.vue";
import { t } from "../../../lang";
import { Dialog } from "../../../lib/dialog";
import { CloudError, CloudService } from "../../../service/CloudService";
import { StorageRecord, StorageService } from "../../../service/StorageService";
import Router from "../../../router";
import { useUserStore } from "../../../store/modules/user";
import { handoff, HandoffTarget } from "./handoff";
import {
    buildMessages,
    commonFields,
    CopyTemplate,
    FormValues,
    maxTokensFor,
    missingFields,
    templates,
} from "./templates";

const user = useUserStore();

const tplId = ref(templates[0].id);
const tpl = computed<CopyTemplate>(
    () => templates.find((x) => x.id === tplId.value) || templates[0],
);
const fields = computed(() => [...commonFields, ...(tpl.value.extraFields ?? [])]);
const values = ref<FormValues>({ tone: "亲切自然" });

const models = ref<{ name: string; version: string; title: string }[]>([]);
const modelKey = ref("");
const model = computed(() => models.value.find((m) => `${m.name}@${m.version}` === modelKey.value));

const generating = ref(false);
const resultText = ref("");
const cost = ref(0);
let abort: AbortController | null = null;

const history = ref<StorageRecord[]>([]);
const HISTORY_LIMIT = 50;

const loadHistory = async () => {
    history.value = (await StorageService.list("Copywriting")).slice(0, HISTORY_LIMIT);
};

onMounted(async () => {
    try {
        models.value = await CloudService.listModels("textGen");
        if (models.value.length > 0) {
            modelKey.value = `${models.value[0].name}@${models.value[0].version}`;
        }
    } catch (e) {
        // 云端清单加载失败时保持空列表，页面上会提示“没有可用模型”
    }
    await loadHistory();
});

const doLogin = () => window.$mapi.user.open();

const doGenerate = async () => {
    if (!user.user.id) {
        Dialog.tipError(t("cloud.loginRequired"));
        doLogin();
        return;
    }
    if (!model.value) {
        Dialog.tipError(t("ecomCopy.noModel"));
        return;
    }
    if (missingFields(tpl.value, values.value).length > 0) {
        Dialog.tipError(t("ecomCopy.fillRequired"));
        return;
    }
    generating.value = true;
    resultText.value = "";
    cost.value = 0;
    abort = new AbortController();
    try {
        const task = await CloudService.run(
            model.value,
            {
                messages: buildMessages(tpl.value, values.value),
                max_tokens: maxTokensFor(tpl.value),
            },
            { signal: abort.signal },
        );
        resultText.value = String(task.result?.text ?? "");
        cost.value = task.cost;
        if (!resultText.value) {
            Dialog.tipError(t("ecomCopy.emptyResult"));
            return;
        }
        await StorageService.add("Copywriting", {
            title: `${t(tpl.value.titleKey)} · ${values.value.product}`.slice(0, 60),
            content: {
                tplId: tpl.value.id,
                values: { ...values.value },
                text: resultText.value,
                model: model.value.title,
                cost: task.cost,
            },
        });
        await loadHistory();
    } catch (e) {
        if (e instanceof CloudError) {
            // 额度不足与未登录已在 CloudService 内提示，这里只处理其余错误
            if (!["CreditNotEnough", "LoginRequired", "Cancelled"].includes(e.type)) {
                Dialog.tipError(e.message);
            }
        } else {
            Dialog.tipError(String(e));
        }
    } finally {
        generating.value = false;
        abort = null;
    }
};

const doCancel = () => abort?.abort();

const doCopy = async () => {
    try {
        await navigator.clipboard.writeText(resultText.value);
        Dialog.tipSuccess(t("common.copySuccess"));
    } catch (e) {
        Dialog.tipError(String(e));
    }
};

// 把文案送到已有功能页（一键合成口播视频 / 长文本转音频），目标页会带入文本，可继续修改后再提交
const doSend = (id: HandoffTarget["id"]) => {
    try {
        handoff(id, resultText.value, (route) => Router.push(route));
        Dialog.tipSuccess(t("ecomCopy.sent"));
    } catch (e) {
        Dialog.tipError(t("ecomCopy.sendEmpty"));
    }
};

const doUseHistory = (r: StorageRecord) => {
    const c = r.content || {};
    if (templates.some((x) => x.id === c.tplId)) tplId.value = c.tplId;
    values.value = { ...c.values };
    resultText.value = c.text || "";
    cost.value = c.cost || 0;
};

const doDeleteHistory = async (r: StorageRecord) => {
    await StorageService.delete(r);
    await loadHistory();
};
</script>

<template>
    <div class="p-5">
        <PageHeader :title="$t('ecomCopy.title')" :desc="$t('ecomCopy.desc')" />

        <div class="flex gap-5">
            <!-- 模板选择 -->
            <div class="w-56 flex-shrink-0">
                <div
                    v-for="x in templates"
                    :key="x.id"
                    class="p-3 rounded-lg mb-2 cursor-pointer border border-solid"
                    :class="
                        tplId === x.id
                            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800'
                    "
                    :data-tpl="x.id"
                    @click="tplId = x.id"
                >
                    <div class="font-bold text-sm">{{ $t(x.titleKey) }}</div>
                    <div class="text-xs text-gray-400 mt-1">{{ $t(x.descKey) }}</div>
                </div>
            </div>

            <!-- 表单与结果 -->
            <div class="flex-grow min-w-0">
                <div v-if="models.length === 0" class="mb-4 text-sm text-orange-500">
                    {{ $t("ecomCopy.noModel") }}
                </div>
                <div v-if="!user.user.id" class="mb-4 text-sm text-gray-500">
                    {{ $t("cloud.loginRequired") }}
                    <a-button size="mini" type="primary" class="ml-2" @click="doLogin">
                        {{ $t("ecomCopy.login") }}
                    </a-button>
                </div>

                <div v-for="f in fields" :key="f.key" class="mb-3">
                    <div class="text-sm mb-1">
                        {{ $t(f.labelKey) }}
                        <span v-if="f.required" class="text-red-500">*</span>
                    </div>
                    <a-textarea
                        v-if="f.type === 'textarea'"
                        v-model="values[f.key]"
                        :placeholder="f.placeholderKey ? $t(f.placeholderKey) : ''"
                        :auto-size="{ minRows: 3, maxRows: 6 }"
                        :max-length="800"
                    />
                    <a-select v-else-if="f.type === 'select'" v-model="values[f.key]">
                        <a-option v-for="o in f.options" :key="o.value" :value="o.value">
                            {{ $t(o.labelKey) }}
                        </a-option>
                    </a-select>
                    <a-input
                        v-else
                        v-model="values[f.key]"
                        :placeholder="f.placeholderKey ? $t(f.placeholderKey) : ''"
                        :max-length="100"
                    />
                </div>

                <div class="flex items-center gap-3 mb-4">
                    <a-select
                        v-model="modelKey"
                        class="w-56"
                        :placeholder="$t('ecomCopy.model')"
                    >
                        <a-option
                            v-for="m in models"
                            :key="`${m.name}@${m.version}`"
                            :value="`${m.name}@${m.version}`"
                        >
                            {{ m.title }}
                        </a-option>
                    </a-select>
                    <a-button
                        v-if="!generating"
                        type="primary"
                        data-action="generate"
                        @click="doGenerate"
                    >
                        {{ $t("common.generate") }}
                    </a-button>
                    <a-button v-else status="danger" @click="doCancel">
                        {{ $t("ecomCopy.cancel") }}
                    </a-button>
                    <span v-if="generating" class="text-sm text-gray-400">
                        {{ $t("ecomCopy.generating") }}
                    </span>
                </div>

                <div v-if="resultText">
                    <div class="flex items-center mb-1">
                        <div class="text-sm font-bold flex-grow">
                            {{ $t("ecomCopy.result") }}
                            <span v-if="cost" class="text-gray-400 font-normal ml-2">
                                {{ $t("ecomCopy.cost", { n: cost }) }}
                            </span>
                        </div>
                        <a-button size="small" class="mr-2" data-action="to-audio" @click="doSend('longTextTts')">
                            {{ $t("ecomCopy.toAudio") }}
                        </a-button>
                        <a-button size="small" type="primary" class="mr-2" data-action="to-video" @click="doSend('videoGenFlow')">
                            {{ $t("ecomCopy.toVideo") }}
                        </a-button>
                        <a-button size="small" @click="doCopy">{{ $t("common.copyText") }}</a-button>
                    </div>
                    <a-textarea v-model="resultText" :auto-size="{ minRows: 8, maxRows: 24 }" />
                </div>

                <!-- 历史 -->
                <div v-if="history.length" class="mt-6">
                    <div class="text-sm font-bold mb-2">{{ $t("ecomCopy.history") }}</div>
                    <div
                        v-for="r in history"
                        :key="r.id"
                        class="flex items-center py-2 border-b border-solid border-gray-100"
                    >
                        <div class="flex-grow min-w-0 cursor-pointer truncate" @click="doUseHistory(r)">
                            {{ r.title }}
                        </div>
                        <a-button size="mini" status="danger" @click="doDeleteHistory(r)">
                            {{ $t("common.delete") }}
                        </a-button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
