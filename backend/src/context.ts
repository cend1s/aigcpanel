import type { ProviderRegistry } from "./cloud/types.js";
import type { Db } from "./db.js";
import type { PaymentRegistry } from "./pay/types.js";

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
};
