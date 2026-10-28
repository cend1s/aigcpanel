import { createHmac, timingSafeEqual } from "node:crypto";
import type { NotifyResult, PayOrder, PaymentProvider } from "../types.js";

// 开发与测试用：没有真实支付，页面上点“模拟支付”即视为到账（仅 PAYMENT_MOCK=1 时注册）。
export class MockPayProvider implements PaymentProvider {
    readonly name = "mock";
    readonly methods = [{ value: "mock", title: "模拟支付（开发）" }];
    readonly ack = { success: "success", fail: "fail" };

    constructor(private secret = "mock-secret") {}

    sign(params: Record<string, string>): string {
        const text = Object.keys(params)
            .filter((k) => k !== "sign")
            .sort()
            .map((k) => `${k}=${params[k]}`)
            .join("&");
        return createHmac("sha256", this.secret).update(text).digest("hex");
    }

    /** 构造一条带签名的回调参数（测试和模拟支付页使用）。 */
    signedNotify(tradeNo: string, moneyCents: number, paid = true): Record<string, string> {
        const p = { out_trade_no: tradeNo, money_cents: String(moneyCents), paid: paid ? "1" : "0" };
        return { ...p, sign: this.sign(p) };
    }

    createPayUrl(order: PayOrder, ctx: { baseUrl: string }): string {
        return `${ctx.baseUrl}/pay/mock?trade_no=${encodeURIComponent(order.tradeNo)}`;
    }

    verifyNotify(params: Record<string, string>): NotifyResult | null {
        const given = Buffer.from(String(params.sign ?? ""));
        const expected = Buffer.from(this.sign(params));
        if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
            return null;
        }
        return {
            tradeNo: params.out_trade_no,
            paid: params.paid === "1",
            moneyCents: Number(params.money_cents),
        };
    }
}
