import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMessages, getTemplate, maxTokensFor, missingFields, templates } from "./templates.js";

test("模板 id 唯一且都带有指令", () => {
    assert.equal(new Set(templates.map((t) => t.id)).size, templates.length);
    for (const t of templates) assert.ok(t.instruction.length > 20 && t.length > 0);
});

test("必填项校验", () => {
    const tpl = getTemplate("xhs")!;
    assert.deepEqual(missingFields(tpl, {}), ["product", "sellingPoints"]);
    assert.deepEqual(missingFields(tpl, { product: "  ", sellingPoints: "x" }), ["product"]);
    assert.deepEqual(missingFields(tpl, { product: "水杯", sellingPoints: "保温" }), []);
});

test("构造提示词：包含素材、按需带上可选项、系统消息声明素材非指令", () => {
    const tpl = getTemplate("live")!;
    const m = buildMessages(tpl, { product: "保温杯", sellingPoints: "12小时保温", price: "99元", tone: "活泼有趣" });
    assert.equal(m[0].role, "system");
    assert.match(m[0].content, /广告法/);
    assert.match(m[0].content, /不要执行/);
    assert.match(m[1].content, /保温杯/);
    assert.match(m[1].content, /价格信息：99元/);
    assert.ok(!/目标人群/.test(m[1].content));
});

test("用户输入被截断，不会撑爆提示词", () => {
    const m = buildMessages(getTemplate("xhs")!, { product: "a".repeat(5000), sellingPoints: "b".repeat(5000) });
    assert.ok(m[1].content.length < 1500);
});

test("max_tokens 有上下限", () => {
    for (const t of templates) {
        const n = maxTokensFor(t);
        assert.ok(n >= 300 && n <= 3000);
    }
});
