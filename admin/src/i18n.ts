import type { I18nProvider } from "@refinedev/core";

// Refine 内置组件文案的中文翻译（键名取自 @refinedev/core 与 @refinedev/antd 的源码）
const zh: Record<string, string> = {
    "buttons.create": "新建",
    "buttons.edit": "编辑",
    "buttons.save": "保存",
    "buttons.cancel": "取消",
    "buttons.delete": "删除",
    "buttons.refresh": "刷新",
    "buttons.list": "返回列表",
    "buttons.show": "查看",
    "buttons.clear": "清空",
    "buttons.filter": "筛选",
    "buttons.confirm": "确定吗？",
    "buttons.logout": "退出登录",
    "actions.list": "列表",
    "actions.create": "新建",
    "actions.edit": "编辑",
    "actions.show": "详情",
    "notifications.success": "成功",
    "notifications.error": "操作失败（{{statusCode}}）",
    "notifications.createSuccess": "创建成功",
    "notifications.createError": "创建失败（{{statusCode}}）",
    "notifications.editSuccess": "保存成功",
    "notifications.editError": "保存失败（{{statusCode}}）",
    "notifications.deleteSuccess": "删除成功",
    "notifications.deleteError": "删除失败（{{statusCode}}）",
    "notifications.undoable": "{{seconds}} 秒内可撤销",
    "pages.login.title": "登录管理后台",
    "pages.login.signin": "登录",
    "pages.login.fields.email": "邮箱",
    "pages.login.fields.password": "密码",
    "pages.error.backHome": "返回首页",
    "pages.error.404": "页面不存在",
    "warnWhenUnsavedChanges": "有未保存的修改，确定离开吗？",
};

export const i18nProvider: I18nProvider = {
    // Refine 有两种调用方式：translate(key, 默认文案) 与 translate(key, 插值参数, 默认文案)
    translate: (key: string, options?: any, defaultMessage?: string) => {
        if (typeof options === "string") {
            defaultMessage = options;
            options = undefined;
        }
        const text = zh[key] ?? defaultMessage ?? key;
        return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(options?.[k] ?? ""));
    },
    changeLocale: async () => undefined,
    getLocale: () => "zh-CN",
};
