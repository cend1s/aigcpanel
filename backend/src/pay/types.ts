export type PayOrder = {
    tradeNo: string;
    moneyCents: number;
    subject: string;
    method: string;
};

export type NotifyResult = {
    tradeNo: string;
    paid: boolean;
    moneyCents: number;
};

// 支付通道接口：国内聚合支付、官方微信/支付宝、Stripe 都按这个接口接入，
// 回调之后的入账、开通订阅、幂等由 orders.ts 统一处理，通道只负责“下单链接”和“验签”。
export interface PaymentProvider {
    readonly name: string;
    /** 该通道支持的支付方式（前端展示用） */
    readonly methods: { value: string; title: string }[];
    createPayUrl(order: PayOrder, ctx: { baseUrl: string }): string;
    /** 验签失败返回 null；验签通过则返回订单号、是否已支付、实付金额（分）。 */
    verifyNotify(params: Record<string, string>): NotifyResult | null;
    /** 回调的应答文本（易支付要求成功时返回 success，否则会持续重试）。 */
    readonly ack: { success: string; fail: string };
}

export class PaymentRegistry {
    private map = new Map<string, PaymentProvider>();
    register(p: PaymentProvider) {
        this.map.set(p.name, p);
        return this;
    }
    get(name: string) {
        return this.map.get(name);
    }
    list() {
        return [...this.map.values()];
    }
}
