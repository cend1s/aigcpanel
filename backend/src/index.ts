import { buildApp } from "./app.js";
import { sweepTasks } from "./cloud/tasks.js";
import { MockProvider } from "./cloud/providers/mock.js";
import { OpenAiChatProvider } from "./cloud/providers/openaiChat.js";
import { ProviderRegistry } from "./cloud/types.js";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { EpayProvider } from "./pay/providers/epay.js";
import { MockPayProvider } from "./pay/providers/mock.js";
import { PaymentRegistry } from "./pay/types.js";

const db = openDb(config.dbFile);

// 云端模型供应商：新增厂商时实现 CloudProvider 并在此注册
const providers = new ProviderRegistry().register(new OpenAiChatProvider());
if (config.mockProvider) providers.register(new MockProvider());

// 支付通道：按环境变量启用
const payments = new PaymentRegistry();
if (config.epay.gateway && config.epay.pid && config.epay.key) payments.register(new EpayProvider(config.epay));
if (config.paymentMock) payments.register(new MockPayProvider());

const app = buildApp({ db, providers, payments, baseUrl: config.baseUrl });

// 每分钟扫描一次悬挂任务，保证崩溃或上游无响应时额度不会一直被冻结
setInterval(() => {
    sweepTasks(db, providers).catch((e) => app.log.error(e, "sweep failed"));
}, 60_000).unref();

app.listen({ port: config.port, host: config.host }).catch((e) => {
    app.log.error(e);
    process.exit(1);
});
