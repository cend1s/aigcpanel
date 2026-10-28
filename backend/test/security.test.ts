import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256 } from "../src/security.js";
import { CODE_MAX_ATTEMPTS } from "../src/security/codes.js";
import { now } from "../src/tx.js";
import { json, post, setup, type Ctx } from "./helpers.js";

// 测试里不能读出图形验证码的答案（只存哈希），所以直接写入一条已知答案的验证码
const seedCaptcha = (ctx: Ctx, answer = "ab12") => {
    const id = `cap-${Math.random()}`;
    ctx.db.prepare("INSERT INTO captchas (id, answer_hash, expires_at) VALUES (?, ?, ?)").run(id, sha256(answer), now() + 300);
    return { captchaId: id, captchaCode: answer };
};

const sendCode = (ctx: Ctx, email: string, purpose: string, captcha = seedCaptcha(ctx)) =>
    json(post(ctx, "/api/auth/send-code", { email, purpose, ...captcha }));

test("图形验证码：生成 SVG；错误答案失败；一次性；过期失效；大小写不敏感", async () => {
    const ctx = await setup();
    const r = await json(ctx.app.inject({ method: "GET", url: "/api/auth/captcha" }) as any);
    assert.equal(r.code, 0);
    assert.match(r.data.svg, /^<svg/);
    assert.match((await json(post(ctx, "/api/auth/captcha"))).data.svg, /^<svg/); // POST 也可用
    assert.equal(ctx.captcha.verify(r.data.id, "zzzz"), false);
    assert.equal(ctx.captcha.verify(r.data.id, "zzzz"), false); // 已作废
    const c = seedCaptcha(ctx, "ab12");
    assert.equal(ctx.captcha.verify(c.captchaId, "AB12"), true);
    assert.equal(ctx.captcha.verify(c.captchaId, "ab12"), false); // 只能用一次
    const old = seedCaptcha(ctx, "xy");
    ctx.db.prepare("UPDATE captchas SET expires_at = 1 WHERE id = ?").run(old.captchaId);
    assert.equal(ctx.captcha.verify(old.captchaId, "xy"), false);
});

test("注册必须邮件验证码：要先过图形验证码；错码失败；正确码成功且只能用一次", async () => {
    const ctx = await setup({ requireEmailCode: true });
    const bad = await json(post(ctx, "/api/auth/send-code", { email: "a@x.com", purpose: "register", captchaId: "x", captchaCode: "y" }));
    assert.equal(bad.data.type, "CaptchaInvalid");
    assert.equal(ctx.mailer.sent.length, 0);

    assert.equal((await sendCode(ctx, "A@x.com", "register")).code, 0);
    const code = ctx.mailer.lastCode("a@x.com");
    assert.match(code, /^\d{6}$/);
    assert.match(ctx.mailer.sent[0].subject, /注册验证码/);

    const noCode = await json(post(ctx, "/api/auth/register", { email: "a@x.com", password: "password1" }));
    assert.equal(noCode.data.type, "CodeInvalid");
    const wrong = await json(post(ctx, "/api/auth/register", { email: "a@x.com", password: "password1", code: code === "000000" ? "111111" : "000000" }));
    assert.equal(wrong.data.type, "CodeInvalid");
    const okReg = await json(post(ctx, "/api/auth/register", { email: "a@x.com", password: "password1", code }));
    assert.equal(okReg.code, 0);
    assert.equal((ctx.db.prepare("SELECT email_verified FROM users WHERE email='a@x.com'").get() as any).email_verified, 1);
    // 同一个码不能再注册第二个账号（也已被注册占用）
    assert.notEqual((await json(post(ctx, "/api/auth/register", { email: "a@x.com", password: "password1", code }))).code, 0);
    // 弱密码注册失败时，验证码不会被消耗
    await sendCode(ctx, "b@x.com", "register");
    const codeB = ctx.mailer.lastCode("b@x.com");
    assert.notEqual((await json(post(ctx, "/api/auth/register", { email: "b@x.com", password: "weakweak", code: codeB }))).code, 0);
    assert.equal((await json(post(ctx, "/api/auth/register", { email: "b@x.com", password: "strong123", code: codeB }))).code, 0);
});

test("发码不暴露账号是否存在：已注册邮箱请求注册码、未注册邮箱请求重置码，都返回相同提示但不发信", async () => {
    const ctx = await setup({ requireEmailCode: false });
    await post(ctx, "/api/auth/register", { email: "exists@x.com", password: "password1" });
    const a = await sendCode(ctx, "exists@x.com", "register");
    const b = await sendCode(ctx, "nobody@x.com", "reset");
    const c = await sendCode(ctx, "fresh@x.com", "register");
    assert.deepEqual([a.code, b.code, c.code], [0, 0, 0]);
    assert.equal(a.data.message, c.data.message);
    assert.deepEqual(ctx.mailer.sent.map((m) => m.to), ["fresh@x.com"]);
});

test("发码频率：60 秒冷却；每天上限 10 次；新码发出后旧码作废", async () => {
    const ctx = await setup();
    await sendCode(ctx, "a@x.com", "register");
    const first = ctx.mailer.lastCode("a@x.com");
    const again = await sendCode(ctx, "a@x.com", "register");
    assert.match(again.msg, /秒后再试/);
    // 把上一条的发送时间挪到 61 秒前，再发一次
    ctx.db.prepare("UPDATE verification_codes SET created_at = created_at - 61").run();
    assert.equal((await sendCode(ctx, "a@x.com", "register")).code, 0);
    const second = ctx.mailer.lastCode("a@x.com");
    const { verifyCode } = await import("../src/security/codes.js");
    if (first !== second) assert.equal(verifyCode(ctx.db, "a@x.com", "register", first), false);
    assert.equal(verifyCode(ctx.db, "a@x.com", "register", second), true);
    // 每日上限
    for (let i = 0; i < 10; i++) {
        ctx.db.prepare("UPDATE verification_codes SET created_at = created_at - 61").run();
        await sendCode(ctx, "a@x.com", "register");
    }
    ctx.db.prepare("UPDATE verification_codes SET created_at = created_at - 61").run();
    assert.match((await sendCode(ctx, "a@x.com", "register")).msg, /上限/);
});

test("验证码错误次数超限后作废；过期失效", async () => {
    const ctx = await setup();
    const { verifyCode } = await import("../src/security/codes.js");
    await sendCode(ctx, "a@x.com", "register");
    const code = ctx.mailer.lastCode("a@x.com");
    const wrongCode = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < CODE_MAX_ATTEMPTS; i++) assert.equal(verifyCode(ctx.db, "a@x.com", "register", wrongCode), false);
    assert.equal(verifyCode(ctx.db, "a@x.com", "register", code), false); // 正确码也已作废

    ctx.db.prepare("UPDATE verification_codes SET created_at = created_at - 61").run();
    await sendCode(ctx, "a@x.com", "register");
    const code2 = ctx.mailer.lastCode("a@x.com");
    ctx.db.prepare("UPDATE verification_codes SET expires_at = 1").run();
    assert.equal(verifyCode(ctx.db, "a@x.com", "register", code2), false);
});

test("登录失败保护：3 次后要图形验证码；8 次锁定（正确密码也不行）；成功登录清零", async () => {
    const ctx = await setup();
    await post(ctx, "/api/auth/register", { email: "a@x.com", password: "password1" });
    const login = (extra: object = {}, password = "wrong-pass1") =>
        json(post(ctx, "/api/auth/login", { email: "a@x.com", password, ...extra }));
    for (let i = 0; i < 2; i++) assert.equal((await login()).data.type, undefined);
    assert.equal((await login()).data.type, "CaptchaRequired"); // 第 3 次失败后提示需要验证码
    // 正确密码但没带验证码：拒绝
    assert.equal((await login({}, "password1")).data.type, "CaptchaRequired");
    // 带正确验证码 + 正确密码：成功并清零
    assert.equal((await login(seedCaptcha(ctx), "password1")).code, 0);
    assert.equal((await login()).data.type, undefined);

    // 连续失败到 8 次：锁定
    let last: any;
    for (let i = 0; i < 7; i++) last = await login(seedCaptcha(ctx));
    assert.equal(last.data.type, "Locked");
    assert.equal((await login(seedCaptcha(ctx), "password1")).data.type, "Locked");
    // 锁定过期后可以正常登录
    ctx.db.prepare("UPDATE login_failures SET locked_until = 1, first_at = 1").run();
    assert.equal((await login({}, "password1")).code, 0);
});

test("不存在的邮箱与存在的邮箱，失败表现一致（无法通过锁定提示枚举账号）", async () => {
    const ctx = await setup();
    await post(ctx, "/api/auth/register", { email: "real@x.com", password: "password1" });
    const seq = async (email: string) => {
        const out: string[] = [];
        for (let i = 0; i < 8; i++) {
            const r = await json(post(ctx, "/api/auth/login", { email, password: "wrong-pass1", ...seedCaptcha(ctx) }));
            out.push(`${r.msg}|${r.data.type ?? ""}`);
        }
        return out;
    };
    assert.deepEqual(await seq("real@x.com"), await seq("ghost@x.com"));
});

test("找回密码：重置后旧密码失效、所有登录被吊销、失败计数清零", async () => {
    const ctx = await setup();
    const reg = await json(post(ctx, "/api/auth/register", { email: "a@x.com", password: "password1" }));
    const oldToken = reg.data.apiToken;
    await post(ctx, "/api/auth/login", { email: "a@x.com", password: "bad-pass1" });
    await sendCode(ctx, "a@x.com", "reset");
    const code = ctx.mailer.lastCode("a@x.com");
    assert.match(ctx.mailer.sent.at(-1)!.subject, /重置密码/);
    // 弱密码被拒绝，且不会消耗验证码
    assert.match((await json(post(ctx, "/api/auth/reset-password", { email: "a@x.com", code, password: "12345678" }))).msg, /字母和数字/);
    assert.equal((await json(post(ctx, "/api/auth/reset-password", { email: "a@x.com", code, password: "newpass99" }))).code, 0);
    assert.equal((await json(post(ctx, "/api/app_manager/user_info", {}, oldToken))).data.user.id, "");
    assert.notEqual((await json(post(ctx, "/api/auth/login", { email: "a@x.com", password: "password1" }))).code, 0);
    assert.equal((await json(post(ctx, "/api/auth/login", { email: "a@x.com", password: "newpass99" }))).code, 0);
    // 错误验证码不能重置
    assert.equal((await json(post(ctx, "/api/auth/reset-password", { email: "a@x.com", code: "000000", password: "another1" }))).data.type, "CodeInvalid");
});

test("密码强度：长度 8-128 且需同时含字母和数字", async () => {
    const ctx = await setup();
    for (const password of ["12345678", "abcdefgh", "a1", "a1".repeat(65)]) {
        assert.notEqual((await json(post(ctx, "/api/auth/register", { email: `p${password.length}${password[0]}@x.com`, password }))).code, 0, password);
    }
});

test("接口限流：发码每分钟 5 次后返回 429（JSON 提示）；按真实 IP 计数", async () => {
    const ctx = await setup({ rateLimit: true, trustProxy: true });
    const send = (ip: string) =>
        ctx.app.inject({ method: "POST", url: "/api/auth/send-code", payload: { email: "a@x.com", purpose: "register" }, headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 5; i++) assert.equal((await send("1.1.1.1")).statusCode, 200);
    const limited = await send("1.1.1.1");
    assert.equal(limited.statusCode, 429);
    assert.match(limited.json().msg, /请求过于频繁/);
    assert.equal((await send("2.2.2.2")).statusCode, 200); // 另一个 IP 不受影响
    // 普通接口有全局限流头
    const r = await ctx.app.inject({ method: "POST", url: "/api/plan/list", payload: {} });
    assert.equal(r.headers["x-ratelimit-limit"], "600");
});
