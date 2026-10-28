import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { safeRedirect } from "../src/routes/appManager.js";

process.env.NODE_ENV = "test";

const setup = async () => {
    const app = buildApp(openDb(":memory:"));
    await app.ready();
    return app;
};

const post = (app: Awaited<ReturnType<typeof setup>>, url: string, body: object, headers = {}) =>
    app.inject({ method: "POST", url, payload: body, headers });

test("注册、登录、user_info 全流程", async () => {
    const app = await setup();
    const reg = (await post(app, "/api/auth/register", { email: "a@b.com", password: "password1" })).json();
    assert.equal(reg.code, 0);
    assert.ok(reg.data.apiToken);

    const login = (await post(app, "/api/auth/login", { email: "A@b.com", password: "password1" })).json();
    assert.equal(login.code, 0);

    const info = (await post(app, "/api/app_manager/user_info", {}, { "api-token": login.data.apiToken })).json();
    assert.equal(info.code, 0);
    assert.equal(info.data.user.name, "a");
    assert.equal(info.data.basic.userEnable, true);
});

test("user_info 在 token 无效时返回空用户且不返回 1001（避免客户端递归刷新）", async () => {
    const app = await setup();
    for (const headers of [{}, { "api-token": "bad" }]) {
        const info = (await post(app, "/api/app_manager/user_info", {}, headers)).json();
        assert.equal(info.code, 0);
        assert.equal(info.data.user.id, "");
        assert.equal(info.data.apiToken, "");
    }
});

test("重复注册、弱密码、错误密码被拒绝", async () => {
    const app = await setup();
    await post(app, "/api/auth/register", { email: "a@b.com", password: "password1" });
    assert.notEqual((await post(app, "/api/auth/register", { email: "a@b.com", password: "password1" })).json().code, 0);
    assert.notEqual((await post(app, "/api/auth/register", { email: "c@d.com", password: "short" })).json().code, 0);
    assert.notEqual((await post(app, "/api/auth/login", { email: "a@b.com", password: "wrong-pass" })).json().code, 0);
    assert.notEqual((await post(app, "/api/auth/login", { email: "none@b.com", password: "password1" })).json().code, 0);
});

test("enter：有效 token 设置 cookie 并跳转站内页，无效 token 去登录页", async () => {
    const app = await setup();
    const reg = (await post(app, "/api/auth/register", { email: "a@b.com", password: "password1" })).json();
    const ok = await app.inject({
        method: "GET",
        url: `/api/app_manager/enter?api_token=${reg.data.apiToken}&url=${encodeURIComponent("/app_manager/user")}`,
    });
    assert.equal(ok.statusCode, 302);
    assert.equal(ok.headers.location, "/app_manager/user");
    assert.match(String(ok.headers["set-cookie"]), /token=/);

    const bad = await app.inject({ method: "GET", url: "/api/app_manager/enter?api_token=nope" });
    assert.equal(bad.headers.location, "/login");
});

test("safeRedirect 拒绝外部地址", () => {
    for (const u of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", undefined, "/a\r\nSet-Cookie: x=1"]) {
        assert.equal(safeRedirect(u), "/app_manager/user");
    }
    assert.equal(safeRedirect("/member"), "/member");
});

test("退出后 token 失效；用户中心页需要登录", async () => {
    const app = await setup();
    const reg = (await post(app, "/api/auth/register", { email: "a@b.com", password: "password1" })).json();
    const token = reg.data.apiToken;
    const page = await app.inject({ method: "GET", url: "/app_manager/user", headers: { cookie: `token=${token}` } });
    assert.equal(page.statusCode, 200);
    await post(app, "/api/auth/logout", {}, { "api-token": token });
    const info = (await post(app, "/api/app_manager/user_info", {}, { "api-token": token })).json();
    assert.equal(info.data.user.id, "");
    const anon = await app.inject({ method: "GET", url: "/app_manager/user" });
    assert.equal(anon.headers.location, "/login");
});
