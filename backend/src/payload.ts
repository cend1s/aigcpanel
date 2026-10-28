import type { User } from "./users.js";

// 返回给桌面端 user:save 的结构，与 electron/mapi/user/main.ts 的 save() 对应
export const userPayload = (user: User | null, apiToken: string) => ({
    apiToken: user ? apiToken : "",
    user: {
        id: user ? String(user.id) : "",
        name: user ? user.nickname : "",
        avatar: user ? user.avatar : "",
        deviceCode: "",
    },
    data: {
        // 功能权限，P2 起由当前订阅套餐计算
        functions: {} as Record<string, unknown>,
    },
    basic: {
        userEnable: true,
    },
});
