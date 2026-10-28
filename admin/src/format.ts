import dayjs from "dayjs";

export const yuan = (cents: number) => `¥${((cents ?? 0) / 100).toFixed(2)}`;
export const time = (sec: number) => (sec ? dayjs(sec * 1000).format("YYYY-MM-DD HH:mm:ss") : "-");
export const REASONS: Record<string, string> = {
    topup: "充值",
    redeem: "兑换码",
    admin_adjust: "后台调额",
    task_reserve: "任务预扣",
    task_refund: "任务退回",
    task_extra: "任务补扣",
};
export const ORDER_STATUS: Record<string, { text: string; color: string }> = {
    pending: { text: "待支付", color: "default" },
    paid: { text: "已支付", color: "green" },
};
export const TASK_STATUS: Record<string, { text: string; color: string }> = {
    reserved: { text: "已预扣", color: "default" },
    running: { text: "运行中", color: "blue" },
    succeeded: { text: "成功", color: "green" },
    failed: { text: "失败", color: "red" },
};
