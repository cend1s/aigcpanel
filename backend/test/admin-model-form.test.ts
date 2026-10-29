import assert from "node:assert/strict";
import { test } from "node:test";
import { formToModel, modelToForm, pricingText, vendorOfBaseUrl } from "../../admin/src/pages/modelForm.js";

const roundTrip = (r: any) => formToModel(modelToForm(r));

test("文生图（硅基流动 Kolors）：表单来回转换后数据不变", () => {
    const r = {
        name: "CloudKolors", version: "1.0", title: "Kolors", description: "图片生成", enabled: true, provider: "openai-image",
        providerConfig: { baseUrl: "https://api.siliconflow.cn/v1", apiKey: "******iiwj", model: "Kwai-Kolors/Kolors" },
        pricing: { type: "per_call", amount: 50 },
        functions: { textToImage: { param: [] } },
    };
    const f = modelToForm(r);
    assert.equal(f.nameSuffix, "Kolors");
    assert.equal(f.vendor, "siliconflow");
    assert.deepEqual(f.functionList, ["textToImage"]);
    assert.deepEqual(roundTrip(r), r);
});

test("文本模型：关闭思考与额外参数写入 extraBody，未知配置原样保留", () => {
    const r = {
        name: "CloudQwen", version: "1.0", title: "Qwen", description: "", enabled: false, provider: "openai-chat",
        providerConfig: { baseUrl: "https://api.siliconflow.cn/v1", apiKey: "k", model: "Qwen/Qwen3-8B", extraBody: { enable_thinking: false, top_p: 0.8, stop: ["x"] }, timeout: 30 },
        pricing: { type: "per_token", inputPer1k: 1, outputPer1k: 3 },
        functions: { textGen: { param: [] } },
    };
    const f = modelToForm(r);
    assert.equal(f.disableThinking, true);
    assert.deepEqual(f.extraParams, [{ key: "top_p", value: "0.8" }, { key: "stop", value: '["x"]' }]);
    assert.deepEqual(roundTrip(r), r);
});

test("语音合成：可选音色生成客户端的音色下拉，默认音色排在选中项", () => {
    const m = formToModel({
        ...modelToForm({}),
        nameSuffix: "Tts", title: "配音", provider: "openai-tts", baseUrl: "https://api.siliconflow.cn/v1", apiKey: "k",
        upstreamModel: "FunAudioLLM/CosyVoice2-0.5B", voices: ["FunAudioLLM/CosyVoice2-0.5B:alex", "FunAudioLLM/CosyVoice2-0.5B:anna"],
        voice: "FunAudioLLM/CosyVoice2-0.5B:anna", audioFormat: "mp3", functionList: ["soundTts"],
        pricingType: "per_unit", unit: "char", amount: 1,
    });
    assert.equal(m.name, "CloudTts");
    assert.deepEqual(m.pricing, { type: "per_unit", unit: "char", amount: 1 });
    assert.equal(m.providerConfig.voice, "FunAudioLLM/CosyVoice2-0.5B:anna");
    const speaker = m.functions.soundTts.param[0];
    assert.equal(speaker.defaultValue, "FunAudioLLM/CosyVoice2-0.5B:anna");
    assert.deepEqual(speaker.options.map((o: any) => o.label), ["alex", "anna"]);
    // 再转回表单，音色列表能还原
    assert.deepEqual(modelToForm(m).voices, ["FunAudioLLM/CosyVoice2-0.5B:alex", "FunAudioLLM/CosyVoice2-0.5B:anna"]);
});

test("语音识别：整段文字与语言写入配置；演示类型不带接口配置", () => {
    const m = formToModel({ ...modelToForm({}), nameSuffix: "Asr", title: "识别", provider: "openai-asr", baseUrl: "u", apiKey: "k", upstreamModel: "FunAudioLLM/SenseVoiceSmall", language: "zh", responseFormat: "json", functionList: ["asr"], pricingType: "per_unit", unit: "minute", amount: 10 });
    assert.deepEqual(m.providerConfig, { baseUrl: "u", apiKey: "k", model: "FunAudioLLM/SenseVoiceSmall", language: "zh", responseFormat: "json" });
    const demo = formToModel({ ...modelToForm({}), nameSuffix: "Demo", title: "演示", provider: "mock", functionList: ["textGen"], pricingType: "per_call", amount: 5 });
    assert.deepEqual(demo.providerConfig, {});
});

test("厂商识别与计价说明", () => {
    assert.equal(vendorOfBaseUrl("https://api.siliconflow.cn/v1/"), "siliconflow");
    assert.equal(vendorOfBaseUrl("https://my.proxy/v1"), "custom");
    assert.equal(pricingText({ type: "per_unit", unit: "minute", amount: 10 }), "10 额度/分钟");
    assert.equal(pricingText({ type: "per_call", amount: 50 }), "50 额度/次");
});
