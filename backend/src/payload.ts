import type { User } from "./users.js";

// 返回给桌面端 user:save 的结构，与 electron/mapi/user/main.ts 的 save() 对应
export const userPayload = (
    user: User | null,
    apiToken: string,
    // 功能权限：由当前生效套餐计算（见 plans.functionsFor）
    functions: Record<string, unknown> = {},
) => ({
    apiToken: user ? apiToken : "",
    user: {
        id: user ? String(user.id) : "",
        name: user ? user.nickname : "",
        avatar: user ? user.avatar : "",
        deviceCode: "",
    },
    data: { functions },
    basic: {
        userEnable: true,
    },
});
