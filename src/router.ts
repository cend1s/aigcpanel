import { createRouter, createWebHashHistory } from "vue-router";

const routes = [
    {
        path: "/",
        component: () => import("./layouts/Main.vue"),
        children: [
            { path: "", component: () => import("./pages/Home.vue") },
            { path: "home", component: () => import("./pages/Home.vue") },
            {
                path: "video",
                component: () => import("./pages/Video.vue"),
            },
            { path: "live", component: () => import("./pages/Live.vue") },
            { path: "server", component: () => import("./pages/Server.vue") },
            { path: "tool", component: () => import("./pages/Tool.vue") },
            { path: "assets", component: () => import("./pages/Assets/AssetCenter.vue") },
            { path: "setting", component: () => import("./pages/Setting.vue") },
        ],
    },
];

const router = createRouter({
    history: createWebHashHistory(),
    routes,
});

// watch router change
router.beforeEach((to, from, next) => {
    window.$mapi?.statistics?.tick("visit", {
        path: to.path,
    });
    next();
});

export default router;
