import { createApp } from "vue";
import store from "../store";

import ArcoVue from "@arco-design/web-vue";
import "@arco-design/web-vue/dist/arco.css";

import { i18n, t } from "../lang";
import "../style.less";
import PageLiveStage from "../pages/Live/PageLiveStage.vue";

// 直播画面窗口：不套通用标题栏，整窗只有画面
const app = createApp(PageLiveStage);
app.use(ArcoVue);
app.use(i18n);
app.use(store);
app.config.globalProperties.$mapi = window.$mapi;
app.config.globalProperties.$t = t as any;
app.mount("#app").$nextTick(() => {
    postMessage({ payload: "removeLoading" }, "*");
});
