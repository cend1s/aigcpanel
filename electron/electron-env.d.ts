/// <reference types="vite-plugin-electron/electron-env" />

declare const __BUILD_ID__: string;
declare const __ECOM_VERSION__: string;

declare namespace NodeJS {
    interface ProcessEnv {
        /**
         * The built directory structure
         *
         * ```tree
         * ├─┬ dist-electron
         * │ ├─┬ main
         * │ │ └── index.js    > Electron-Main
         * │ └─┬ preload
         * │   └── index.mjs   > Preload-Scripts
         * ├─┬ dist
         * │ └── index.html    > Electron-Renderer
         * ```
         */
        APP_ROOT: string;
        /** /dist/ or /public/ */
        VITE_PUBLIC: string;
    }
}
