import { ffprobeGetMediaDuration } from "../lib/ffprobe";
import {
    AssetContent,
    AssetRecord,
    AssetType,
    detectType,
    normalizeTags,
    pendingTaskAssets,
    TASK_RESULT_SOURCES,
} from "../pages/Assets/assets";
import { StorageService } from "./StorageService";
import { TaskService } from "./TaskService";

// 资产中心：存放在通用的 data_storage 表（biz = Asset），不需要改数据库结构。
// 媒体文件字段用 content.file 而不是 url：StorageService.delete 会自动删除 url 指向的文件，
// 而引用的任务结果文件不能被资产中心删掉，是否删除由 owned 决定。

const BIZ = "Asset" as const;

const blank = (type: AssetType): AssetContent => ({
    type,
    file: "",
    text: "",
    tags: [],
    note: "",
    source: "upload",
    sourceTaskId: "",
    owned: false,
    duration: 0,
    size: 0,
    createdAt: Date.now(),
});

export const AssetService = {
    async list(): Promise<AssetRecord[]> {
        return (await StorageService.list(BIZ)).map((r) => ({
            id: r.id,
            title: r.title || "",
            content: { ...blank("text"), ...(r.content || {}) },
        }));
    },

    /** 导入本地文件：复制到软件自己的存储目录，原文件删除或移动后资产仍然可用 */
    async importFiles(files: string[], tags: string[] = []): Promise<{ imported: number; skipped: string[] }> {
        const skipped: string[] = [];
        let imported = 0;
        for (const path of files) {
            const type = detectType(path);
            if (!type || type === "text") {
                skipped.push(path);
                continue;
            }
            const file = await window.$mapi.file.hubSave(path, { saveGroup: "asset" } as any);
            const stat = await window.$mapi.file.stat(file).catch(() => null);
            let duration = 0;
            if (type === "video" || type === "audio") {
                duration = await ffprobeGetMediaDuration(file).catch(() => 0);
            }
            await StorageService.add(BIZ, {
                title: await window.$mapi.file.pathToName(path, false),
                content: { ...blank(type), file, tags: normalizeTags(tags), owned: true, duration, size: stat?.size ?? 0 },
            });
            imported++;
        }
        return { imported, skipped };
    },

    async addText(title: string, text: string, tags: string[] = [], source: AssetContent["source"] = "upload") {
        await StorageService.add(BIZ, {
            title: title.trim().slice(0, 60) || text.trim().slice(0, 20),
            content: { ...blank("text"), text, tags: normalizeTags(tags), source },
        });
    },

    /** 把已完成任务的结果（文生图、剪辑矩阵等）收进资产中心，已收录的跳过；文件仍归任务所有 */
    async importTaskResults(): Promise<number> {
        const existing = await this.list();
        const tasks: any[] = [];
        for (const biz of Object.keys(TASK_RESULT_SOURCES)) {
            tasks.push(...(await TaskService.list(biz as any)));
        }
        const pending = pendingTaskAssets(tasks, existing);
        for (const a of pending) {
            await StorageService.add(BIZ, a as any);
        }
        return pending.length;
    },

    async update(id: number, patch: { title?: string; tags?: string[] | string; note?: string; text?: string }) {
        const current = (await this.list()).find((a) => a.id === id);
        if (!current) return;
        const content = { ...current.content };
        if (patch.tags !== undefined) content.tags = normalizeTags(patch.tags);
        if (patch.note !== undefined) content.note = patch.note.slice(0, 500);
        if (patch.text !== undefined && content.type === "text") content.text = patch.text;
        await StorageService.update(id, { title: (patch.title ?? current.title).slice(0, 60), content });
    },

    async remove(asset: AssetRecord) {
        if (asset.content.owned && asset.content.file) {
            await window.$mapi.file.deletes(asset.content.file).catch(() => undefined);
        }
        await StorageService.delete({ id: asset.id, biz: BIZ, title: asset.title, content: {} } as any);
    },
};
