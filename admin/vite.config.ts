import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 构建产物由后端托管在 /admin/ 下；开发时把 /api 代理到本地后端
export default defineConfig({
    base: "/admin/",
    plugins: [react()],
    server: {
        port: 5180,
        proxy: { "/api": process.env.API_TARGET ?? "http://127.0.0.1:3100" },
    },
});
