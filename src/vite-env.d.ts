/// <reference types="vite/client" />
import type { Router } from "vue-router";

declare const __BUILD_ID__: string;

declare global {
    // 构建时注入的电商版版本号（vite.config.ts 的 define）
    const __ECOM_VERSION__: string;
    interface Window {
        __test?: import("./utils/test").TestRegistry;
    }
}

declare module "*.vue" {
    import type { DefineComponent } from "vue";
    const component: DefineComponent<{}, {}, any>;
    export default component;
}

declare module "@vue/runtime-core" {
    interface ComponentCustomProperties {
        $router: Router;
        $dialog: Dialog;
        $t: typeof import("vue-i18n").GlobalTranslate;
    }
}
