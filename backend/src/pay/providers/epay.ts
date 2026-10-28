import { createHash, timingSafeEqual } from "node:crypto";
import type { NotifyResult, PayOrder, PaymentProvider } from "../types.js";

// 易支付协议（国内聚合通道常用）：参数按 key 排序拼接后追加商户密钥做 MD5。
// 注意：按公开协议实现，尚未对接真实网关联调，上线前需用商户测试环境验证。
export class EpayProvider implements PaymentProvider {
    readonly name = "epay";
    readonly methods = [
        { value: "alipay", title: "支付宝" },
        { value: "wxpay", title: "微信支付" },
    ];
    readonly ack = { success: "success", fail: "fail" };

    constructor(
        private cfg: { gateway: string; pid: string; key: string },
    ) {}

    sign(params: Record<string, string>): string {
        const text = Object.keys(params)
            .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== "" && params[k] != null)
            .sort()
            .map((k) => `${k}=${params[k]}`)
            .join("&");
        return createHash("md5").update(text + this.cfg.key).digest("hex");
    }

    createPayUrl(order: PayOrder, ctx: { baseUrl: string }): string {
        const params: Record<string, string> = {
            pid: this.cfg.pid,
            type: order.method || "alipay",
            out_trade_no: order.tradeNo,
            notify_url: `${ctx.baseUrl}/api/pay/notify/epay`,
            return_url: `${ctx.baseUrl}/app_manager/user`,
            name: order.subject,
            money: (order.moneyCents / 100).toFixed(2),
        };
        params.sign = this.sign(params);
        params.sign_type = "MD5";
        return `${this.cfg.gateway.replace(/\/$/, "")}/submit.php?${new URLSearchParams(params)}`;
    }

    verifyNotify(params: Record<string, string>): NotifyResult | null {
        const given = Buffer.from(String(params.sign ?? ""));
        const expected = Buffer.from(this.sign(params));
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
            return null;
        }
        if (params.pid !== this.cfg.pid || !params.out_trade_no) {
            return null;
        }
        return {
            tradeNo: params.out_trade_no,
            paid: params.trade_status === "TRADE_SUCCESS",
            moneyCents: Math.round(Number(params.money) * 100),
        };
    }
}
