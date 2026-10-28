import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { userPayload } from "../payload.js";
import { functionsFor } from "../plans.js";
import { fail, ok } from "../response.js";
import { CodeError, sendCode, verifyCode, type CodePurpose } from "../security/codes.js";
import { clearFailures, guardState, recordFailure } from "../security/loginGuard.js";
import { COOKIE_NAME, setSessionCookie } from "../session.js";
import {
    assertEmail,
    assertPassword,
    issueToken,
    login,
    normalizeEmail,
    register,
    resetPassword,
    revokeToken,
    userExists,
    UserError,
} from "../users.js";

type Body = {
    email?: string;
    password?: string;
    nickname?: string;
    deviceUuid?: string;
    code?: string;
    purpose?: string;
    captchaId?: string;
    captchaCode?: string;
};

// 敏感接口的单 IP 限流（每分钟），在全局限流之外再收紧
const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: "1 minute" } } });

export const authRoutes = (app: FastifyInstance, ctx: AppContext) => {
    const { db, mailer, captcha, security } = ctx;

    // GET 供网页直接请求，POST 与其余接口（含管理后台、桌面端 apiPost）保持一致
    app.route({
        method: ["GET", "POST"],
        url: "/api/auth/captcha",
        ...limit(30),
        handler: async (_req, reply) => {
            reply.header("Cache-Control", "no-store");
            return ok(captcha.create());
        },
    });

    // 发送邮件验证码：必须先通过图形验证码，防止被用来轰炸他人邮箱。
    // 无论邮箱是否已注册，返回的提示都一样，避免借此探测账号是否存在。
    app.post("/api/auth/send-code", limit(5), async (req) => {
        const b = (req.body ?? {}) as Body;
        const email = normalizeEmail(b.email);
        const purpose = b.purpose as CodePurpose;
        if (purpose !== "register" && purpose !== "reset") return fail("用途无效");
        try {
            assertEmail(email);
        } catch (e) {
            return fail((e as Error).message);
        }
        if (!captcha.verify(b.captchaId, b.captchaCode)) {
            return fail("图形验证码错误", -1, { type: "CaptchaInvalid" });
        }
        const exists = userExists(db, email);
        // 注册只给未注册的邮箱发，重置只给已注册的邮箱发；其余情况静默跳过
        if ((purpose === "register" && !exists) || (purpose === "reset" && exists)) {
            try {
                await sendCode(db, mailer, { email, purpose, ip: req.ip, appName: security.appName });
            } catch (e) {
                if (e instanceof CodeError) return fail(e.message);
                req.log.error({ err: e }, "send code failed");
                return fail("验证码发送失败，请稍后重试");
            }
        }
        return ok({ message: "如果邮箱可用，验证码已发送，请查收（10 分钟内有效）" });
    });

    app.post("/api/auth/register", limit(10), async (req, reply) => {
        const b = (req.body ?? {}) as Body;
        const email = normalizeEmail(b.email);
        try {
            // 先校验格式再核对验证码：验证码一经核对成功就作废，不能因为密码太弱白白浪费
            assertEmail(email);
            assertPassword(b.password);
            if (security.requireEmailCode && !verifyCode(db, email, "register", b.code)) {
                return fail("邮箱验证码错误或已过期", -1, { type: "CodeInvalid" });
            }
            const user = register(db, email, b.password ?? "", b.nickname, security.requireEmailCode);
            const token = issueToken(db, user.id, b.deviceUuid);
            setSessionCookie(reply, token);
            return ok(userPayload(user, token, functionsFor(db, user.id)));
        } catch (e) {
            if (e instanceof UserError) return fail(e.message);
            throw e;
        }
    });

    app.post("/api/auth/login", limit(20), async (req, reply) => {
        const b = (req.body ?? {}) as Body;
        const email = normalizeEmail(b.email);
        const state = guardState(db, email);
        if (state.lockedFor > 0) {
            return fail(`登录失败次数过多，请 ${Math.ceil(state.lockedFor / 60)} 分钟后再试`, -1, { type: "Locked" });
        }
        if (state.captchaRequired && !captcha.verify(b.captchaId, b.captchaCode)) {
            return fail("请输入正确的图形验证码", -1, { type: "CaptchaRequired" });
        }
        try {
            const user = login(db, email, b.password ?? "");
            clearFailures(db, email);
            const token = issueToken(db, user.id, b.deviceUuid);
            setSessionCookie(reply, token);
            return ok(userPayload(user, token, functionsFor(db, user.id)));
        } catch (e) {
            if (e instanceof UserError) {
                const after = recordFailure(db, email);
                if (after.lockedFor > 0) {
                    return fail(`登录失败次数过多，请 ${Math.ceil(after.lockedFor / 60)} 分钟后再试`, -1, { type: "Locked" });
                }
                return fail(e.message, -1, after.captchaRequired ? { type: "CaptchaRequired" } : {});
            }
            throw e;
        }
    });

    app.post("/api/auth/reset-password", limit(10), async (req) => {
        const b = (req.body ?? {}) as Body;
        const email = normalizeEmail(b.email);
        try {
            assertPassword(b.password);
            if (!verifyCode(db, email, "reset", b.code)) {
                return fail("邮箱验证码错误或已过期", -1, { type: "CodeInvalid" });
            }
            resetPassword(db, email, b.password ?? "");
            clearFailures(db, email);
            return ok({});
        } catch (e) {
            if (e instanceof UserError) return fail(e.message);
            throw e;
        }
    });

    app.post("/api/auth/logout", async (req, reply) => {
        revokeToken(db, req.cookies?.[COOKIE_NAME]);
        const header = req.headers["api-token"];
        if (typeof header === "string") {
            revokeToken(db, header);
        }
        reply.clearCookie(COOKIE_NAME, { path: "/" });
        return ok({});
    });
};
