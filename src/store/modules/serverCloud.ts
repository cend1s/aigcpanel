import { defineStore } from "pinia";
import { buildServerContent } from "../../lib/aigcpanel";
import { wait } from "../../lib/util";
import {
    EnumServerStatus,
    EnumServerType,
    ServerRecord,
} from "../../types/Server";
import store from "../index";
import { useServerStore } from "./server";

export type VideoTemplateCloudRecord = {
    id: string;
    tags: string[];
    title: string;
    cover: string;
};

export type ServerCloudRecord = {
    logo: string;
    url: string;
    demo: any[];
    key: string;
    name: string;
    title: string;
    version: string;
    description: string;
    content: string;
    functions: {
        [key: string]: {
            param: {
                name: string;
                type: string;
                [key: string]: any;
            }[];
        };
    };
    runtime: {
        functions: string[];
        content: string;
    };
};

export const serverCloudStore = defineStore("serverCloud", {
    state: () => ({
        isReady: false,
        records: [] as ServerCloudRecord[],
        videoTemplateRecords: [] as VideoTemplateCloudRecord[],
    }),
    actions: {
        async waitReady() {
            await wait(() => this.isReady);
        },
        async init() {
            try {
                await this.refresh();
            } finally {
                // 服务端未启动等原因拉取失败时也要标记就绪，否则等待它的页面会一直卡住
                this.isReady = true;
            }
            // 管理后台新增/修改模型后，桌面端无需重启：登录状态变化、窗口重新获得焦点、每分钟都会刷新
            window.__page?.onBroadcast?.("UserChange", () => this.refresh());
            window.addEventListener("focus", () => this.refresh());
            setInterval(() => this.refresh(), 60 * 1000);
        },
        async refresh() {
            const res = await $mapi.user.apiPost("server/all", {}, { throwException: false });
            if (res.code || !Array.isArray(res.data?.records)) {
                return;
            }
            this.records = res.data.records.map((r: any) => {
                return {
                    ...r,
                    key: this.generateServerKey(r),
                    status: EnumServerStatus.RUNNING,
                    type: EnumServerType.CLOUD,
                    autoStart: true,
                    runtime: {
                        functions: Object.keys(r.functions),
                        content: buildServerContent(r),
                    },
                };
            });
            // 并入统一的模型列表：「AI模型」页面、各功能的模型选择器、任务执行都从这里查找
            useServerStore().setCloudRecords(
                res.data.records.map((r: any) => ({
                    key: this.generateServerKey(r),
                    name: r.name,
                    title: r.title,
                    version: r.version,
                    type: EnumServerType.CLOUD,
                    functions: Object.keys(r.functions || {}),
                    // 每个云端模型一个独立的驱动实例（主进程按 localPath 缓存）
                    localPath: `cloud:${r.name}:${r.version}`,
                    autoStart: true,
                    setting: {},
                    cloudConfig: {
                        functions: r.functions || {},
                        content: buildServerContent(r),
                        description: r.description,
                        logo: r.logo,
                    },
                })),
            );
        },
        async getByKey(key: string): Promise<ServerRecord | undefined> {
            return this.records.find((record) => record.key === key) as any;
        },
        async getByNameVersion(
            name: string,
            version: string,
        ): Promise<ServerRecord | undefined> {
            return this.records.find(
                (record) => record.name === name && record.version === version,
            ) as any;
        },
        generateServerKey(serverCloud: ServerRecord) {
            return `${serverCloud.name}|${serverCloud.version}`;
        },
        async listVideoTemplates() {
            const res = await $mapi.user.apiPost(
                "aigcpanel/video_template/all",
                {},
            );
            this.videoTemplateRecords = res.data.records;
        },
        async getVideoTemplate(id: string): Promise<VideoTemplateCloudRecord> {
            const res = await $mapi.user.apiPost(
                "aigcpanel/video_template/get",
                { id },
            );
            return res.data.record;
        },
    },
});

const serverCloud = serverCloudStore(store);
serverCloud.init().then(() => {});

export const useServerCloudStore = () => {
    return serverCloud;
};
