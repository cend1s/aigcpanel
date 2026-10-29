import { ipcRenderer } from "electron";

// 弹幕监听 webview 专用的 preload：直播间是第三方网页，只给它一个把事件发回监听窗口的口子，
// 不暴露软件的 $mapi 等接口。
(window as any).__page = {
    ipcSendToHost: (channel: string, type: string, data?: any) => {
        ipcRenderer.sendToHost(channel, { type, data });
    },
};
