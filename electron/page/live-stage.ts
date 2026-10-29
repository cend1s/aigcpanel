import { BrowserWindow } from "electron";
import { preloadDefault } from "../lib/env-main";
import { AppRuntime } from "../mapi/env";
import { Page } from "./index";

// 直播画面窗口：带系统标题栏（方便直播伴侣按窗口标题选择），内容区就是直播画面。
export const PageLiveStage = {
    NAME: "live-stage",
    open: async (option: { width?: number; height?: number; title?: string }) => {
        const width = Math.max(240, Math.round(option.width || 405));
        const height = Math.max(240, Math.round(option.height || 720));
        const existing = AppRuntime.windows[PageLiveStage.NAME];
        if (existing && !existing.isDestroyed()) {
            existing.setContentSize(width, height);
            existing.show();
            return;
        }
        const win = new BrowserWindow({
            title: option.title || "AigcPanel 直播画面",
            width,
            height,
            useContentSize: true,
            backgroundColor: "#000000",
            autoHideMenuBar: true,
            show: true,
            frame: true,
            resizable: true,
            webPreferences: {
                preload: preloadDefault,
                nodeIntegration: true,
                contextIsolation: false,
                webSecurity: false,
                // 被别的窗口挡住或最小化时也要照常播放、照常计时
                backgroundThrottling: false,
                autoplayPolicy: "no-user-gesture-required",
            },
        });
        win.setMenuBarVisibility(false);
        // 页面标题会覆盖窗口标题，这里固定住，直播伴侣按标题找窗口
        win.on("page-title-updated", (e) => e.preventDefault());
        await Page.openWindow(PageLiveStage.NAME, win, "page/live-stage.html");
    },
};
