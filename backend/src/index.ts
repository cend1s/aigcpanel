import { buildApp } from "./app.js";
import { sweepTasks } from "./cloud/tasks.js";
import { MockProvider } from "./cloud/providers/mock.js";
import { createFileStore } from "./cloud/files.js";
import { OpenAiImageProvider } from "./cloud/providers/openaiImage.js";
import { OpenAiAsrProvider, OpenAiTtsProvider } from "./cloud/providers/openaiAudio.js";
import { OpenAiChatProvider } from "./cloud/providers/openaiChat.js";
import { ProviderRegistry } from "./cloud/types.js";
import { config } from "./config.js";
import { SERVER_VERSION } from "./version.js";
import { openDb } from "./db.js";
import { EpayProvider } from "./pay/providers/epay.js";
import { MockPayProvider } from "./pay/providers/mock.js";
import { PaymentRegistry } from "./pay/types.js";
import { SvgCaptchaService } from "./security/captcha.js";
import { LogMailer, SmtpMailer, type Mailer } from "./security/mailer.js";

const db = openDb(config.dbFile);

// 云端模型供应商：新增厂商时实现 CloudProvider 并在此注册
const files = createFileStore(config.filesDir, config.baseUrl);
const providers = new ProviderRegistry()
    .register(new OpenAiChatProvider())
    .register(new OpenAiImageProvider(files))
    .register(new OpenAiAsrProvider())
    .register(new OpenAiTtsProvider(files));
if (config.mockProvider) providers.register(new MockProvider(files));

// 支付通道：按环境变量启用
const payments = new PaymentRegistry();
if (config.epay.gateway && config.epay.pid && config.epay.key) payments.register(new EpayProvider(config.epay));
if (config.paymentMock) payments.register(new MockPayProvider());

// 邮件：配置了 SMTP 就用 SMTP；否则仅允许在非生产环境用日志代替（验证码会打印在服务日志里）
let mailer: Mailer;
if (config.smtp.host) {
    mailer = new SmtpMailer(config.smtp, config.smtp.from || config.smtp.user);
} else if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境必须配置 SMTP_HOST 等邮件参数，否则用户收不到验证码");
} else {
    mailer = new LogMailer((msg) => console.warn(msg));
}

const app = buildApp({
    db,
    providers,
    payments,
    baseUrl: config.baseUrl,
    filesDir: config.filesDir,
    adminDir: config.adminDir,
    mailer,
    captcha: new SvgCaptchaService(db),
    security: {
        requireEmailCode: config.requireEmailCode,
        rateLimit: true,
        trustProxy: config.trustProxy,
        appName: config.appName,
    },
});

// 每分钟扫描一次悬挂任务，保证崩溃或上游无响应时额度不会一直被冻结
setInterval(() => {
    sweepTasks(db, providers).catch((e) => app.log.error(e, "sweep failed"));
}, 60_000).unref();

app.listen({ port: config.port, host: config.host })
    .then(() => console.log(`服务端版本：${SERVER_VERSION}`))
    .catch((e) => {
        app.log.error(e);
        process.exit(1);
    });
