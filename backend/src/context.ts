import type { ProviderRegistry } from "./cloud/types.js";
import type { Db } from "./db.js";
import type { PaymentRegistry } from "./pay/types.js";
import type { CaptchaService } from "./security/captcha.js";
import type { Mailer } from "./security/mailer.js";

export type AppContext = {
    db: Db;
    providers: ProviderRegistry;
    payments: PaymentRegistry;
    // 对外可访问的地址，用于生成支付回调和跳转链接
    baseUrl: string;
    // 供应商返回的文件落盘目录
    filesDir: string;
    // 管理后台构建产物目录（admin/dist），存在时挂载到 /admin/
    adminDir?: string;
    mailer: Mailer;
    captcha: CaptchaService;
    security: {
        /** 注册是否必须邮件验证码（生产必须为 true） */
        requireEmailCode: boolean;
        /** 是否启用接口限流（测试里关闭，避免批量注册被限） */
        rateLimit: boolean;
        /** 是否信任反向代理传来的 X-Forwarded-For（部署在 nginx 后面时开启） */
        trustProxy: boolean;
        appName: string;
    };
};
