import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

test("桌面端启动时的检查更新与统计上报不能返回 404（否则会弹出 Not Found）", async () => {
    const ctx = await setup();
    const up = await ctx.app.inject({ method: "POST", url: "/app_manager/updater/open", payload: { version: "2.7.0-beta" } });
    assert.equal(up.statusCode, 200);
    assert.deepEqual(up.json(), { code: 0, msg: "ok", data: { version: "2.7.0-beta" } });
    const col = await ctx.app.inject({ method: "POST", url: "/app_manager/collect", payload: { a: 1 } });
    assert.equal(col.json().code, 0);
    const v = await ctx.app.inject({ method: "GET", url: "/api/version" });
    assert.equal(v.json().data.version, "dev");
});
