import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { handoff, handoffTargets, toSpokenText } from "./handoff.js";

test("目标页源码里确实使用了约定的草稿 key（防止改名后悄悄失效）", () => {
    for (const t of Object.values(handoffTargets)) {
        const src = readFileSync(t.sourceFile, "utf8");
        assert.ok(src.includes(`"${t.storageKey}"`), `${t.sourceFile} 应包含 ${t.storageKey}`);
    }
});

test("目标页路由真实存在对应的 tab 名称", () => {
    assert.ok(readFileSync("src/pages/Video.vue", "utf8").includes('"VideoGenFlow"'));
    assert.ok(readFileSync("src/pages/Apps/all.ts", "utf8").includes('name: "LongTextTts"'));
});

test("口播文本整理：去标签、表情、Markdown、链接，保留正文", () => {
    const raw = "## 夏天必备🔥\n\n**316 不锈钢**保温杯，真的很好用😍\n- 12 小时保温\n- 一键开盖\n详情见 https://x.com/a?b=1\n#保温杯 #好物分享";
    assert.equal(toSpokenText(raw), "夏天必备\n\n316 不锈钢保温杯，真的很好用\n12 小时保温\n一键开盖\n详情见");
});

test("正常的中文标点、数字、井号以外的符号不受影响", () => {
    assert.equal(toSpokenText("价格：99 元！限时 5 折，(买一送一)。"), "价格：99 元！限时 5 折，(买一送一)。");
});

test("handoff 写入草稿并导航；空文本报错且不写入", () => {
    const store = new Map<string, string>();
    (globalThis as any).window = { localStorage: { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => store.delete(k) } };
    let route: any;
    const out = handoff("videoGenFlow", "大家好🔥 #好物", (r) => (route = r));
    assert.equal(out, "大家好");
    assert.deepEqual(JSON.parse(store.get("VideoGenFlowCreate.formData")!), { text: "大家好" });
    assert.deepEqual(route, { path: "/video", query: { tab: "VideoGenFlow" } });
    store.clear();
    assert.throws(() => handoff("longTextTts", "🔥 #a", () => {}), /EmptyText/);
    assert.equal(store.size, 0);
});
