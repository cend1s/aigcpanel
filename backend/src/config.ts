export const config = {
    port: Number(process.env.PORT ?? 3100),
    host: process.env.HOST ?? "127.0.0.1",
    dbFile: process.env.DB_FILE ?? "data/app.db",
    // 对外访问地址，用于支付回调与跳转；生产环境必须配置为公网 https 地址
    baseUrl: process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3100}`,
    adminDir: process.env.ADMIN_DIR ?? "../admin/dist",
    filesDir: process.env.FILES_DIR ?? "data/files",
    paymentMock: process.env.PAYMENT_MOCK === "1",
    epay: {
        gateway: process.env.EPAY_GATEWAY ?? "",
        pid: process.env.EPAY_PID ?? "",
        key: process.env.EPAY_KEY ?? "",
    },
    mockProvider: process.env.MOCK_PROVIDER === "1",
    appName: process.env.APP_NAME ?? "AIGCPanel",
    // 注册必须邮件验证码；仅本地开发可设 REQUIRE_EMAIL_CODE=0 关闭
    requireEmailCode: process.env.REQUIRE_EMAIL_CODE !== "0",
    trustProxy: process.env.TRUST_PROXY === "1",
    smtp: {
        host: process.env.SMTP_HOST ?? "",
        port: Number(process.env.SMTP_PORT ?? 465),
        secure: (process.env.SMTP_SECURE ?? "1") === "1",
        user: process.env.SMTP_USER ?? "",
        pass: process.env.SMTP_PASS ?? "",
        from: process.env.SMTP_FROM ?? "",
    },
};
