export const config = {
    port: Number(process.env.PORT ?? 3100),
    host: process.env.HOST ?? "127.0.0.1",
    dbFile: process.env.DB_FILE ?? "data/app.db",
    // 对外访问地址，用于支付回调与跳转；生产环境必须配置为公网 https 地址
    baseUrl: process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3100}`,
    paymentMock: process.env.PAYMENT_MOCK === "1",
    epay: {
        gateway: process.env.EPAY_GATEWAY ?? "",
        pid: process.env.EPAY_PID ?? "",
        key: process.env.EPAY_KEY ?? "",
    },
    mockProvider: process.env.MOCK_PROVIDER === "1",
};
