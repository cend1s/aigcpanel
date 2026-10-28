import { ffmpegOptimized } from "../../../lib/ffmpeg";
import { ffprobeGetMediaDuration } from "../../../lib/ffprobe";
import { DataService } from "../../../service/DataService";
import { TaskRecord, TaskService } from "../../../service/TaskService";
import { useServerStore } from "../../../store/modules/server";
import { TaskBiz, useTaskStore } from "../../../store/modules/task";
import { LongTextTtsRun } from "../LongTextTts/task";
import { VideoSubtitleRun } from "../VideoSubtitle/task";
import { buildRenderArgs, buildSrt, planSegments, RATIOS } from "./render";
import { ClipMatrixJobResultType, ClipMatrixModelConfigType } from "./type";

const serverStore = useServerStore();
const taskStore = useTaskStore();

// 任务调度器本身不限并发：一次提交几十条时，若同时跑几十个 ffmpeg 会拖垮机器。
// 合成与字幕两步各自限制并发，超出时返回 retry，1 秒后自动重新排队。
const MAX_RENDER = 2;
const MAX_SUBTITLE = 2;
let rendering = 0;
const subtitling = new Set<string>();

/**
 * 查询子任务：成功返回结果文件，失败抛出原因，未完成返回 null（本任务返回 retry，稍后再查）。
 * 用轮询而不是事件等待，应用重启后也能接着等。
 */
const subTaskResult = async (taskId: string): Promise<string | null> => {
    const task = await TaskService.get(taskId);
    if (!task) throw "子任务不存在";
    if (task.status === "success") {
        if (!task.result?.url) throw "子任务没有结果文件";
        return task.result.url;
    }
    if (task.status === "fail") throw task.statusMsg || "子任务失败";
    if (task.status === "pause") throw "子任务已暂停";
    return null;
};

export const ClipMatrixCleaner = async (task: TaskRecord) => {
    const jobResult: ClipMatrixJobResultType = task.jobResult;
    const files = [jobResult?.Render?.file, jobResult?.Subtitle?.srt].filter(Boolean) as string[];
    return { files };
};

export const ClipMatrix: TaskBiz = {
    runFunc: async (bizId, bizParam) => {
        const { record } = await serverStore.prepareForTask(bizId, bizParam);
        const cfg: ClipMatrixModelConfigType = record.modelConfig;
        const jobResult: ClipMatrixJobResultType = record.jobResult;
        jobResult.step = jobResult.step || "Audio";
        jobResult.Audio = jobResult.Audio || { status: "queue", taskId: "", file: "", duration: 0 };
        jobResult.Render = jobResult.Render || { status: "queue", file: "" };
        jobResult.Subtitle = jobResult.Subtitle || { status: "queue", taskId: "", srt: "", file: "" };

        if (jobResult.step === "Audio") {
            jobResult.Audio.status = "running";
            if (!jobResult.Audio.taskId) {
                const sub = await LongTextTtsRun({
                    taskId: "",
                    title: `${cfg.batchTitle} #${cfg.variant.index + 1} 配音`,
                    text: cfg.script,
                    soundGenerate: cfg.soundGenerate,
                });
                jobResult.Audio.taskId = sub.taskId;
            }
            await TaskService.update(bizId, { status: "running", jobResult });
            taskStore.fireChange({ biz: "ClipMatrix", bizId }, "running");
            const audio = await subTaskResult(jobResult.Audio.taskId);
            if (!audio) return "retry";
            jobResult.Audio.file = audio;
            jobResult.Audio.duration = await ffprobeGetMediaDuration(audio);
            jobResult.Audio.status = "success";
            jobResult.step = "Render";
            await TaskService.update(bizId, { jobResult });
        }

        if (jobResult.step === "Render") {
            if (rendering >= MAX_RENDER) return "retry";
            rendering++;
            jobResult.Render.status = "running";
            const output = await $mapi.file.temp("mp4");
            try {
                await TaskService.update(bizId, { status: "running", jobResult });
                const segments = planSegments(cfg.clips, cfg.variant, jobResult.Audio.duration);
                await ffmpegOptimized(
                    buildRenderArgs({
                        clips: cfg.clips,
                        segments,
                        variant: cfg.variant,
                        audio: jobResult.Audio.file,
                        audioDuration: jobResult.Audio.duration,
                        size: RATIOS[cfg.ratio] ?? RATIOS["9:16"],
                        output,
                    }),
                    { successFileCheck: output },
                );
            } finally {
                rendering--;
            }
            jobResult.Render.file = output;
            jobResult.Render.status = "success";
            jobResult.step = cfg.subtitle ? "Subtitle" : "End";
            await TaskService.update(bizId, { jobResult });
        }

        if (jobResult.step === "Subtitle") {
            jobResult.Subtitle.status = "running";
            if (!jobResult.Subtitle.taskId) {
                if (subtitling.size >= MAX_SUBTITLE) return "retry";
                // 字幕复用原项目的「视频添加字幕」：用文案和配音时长生成 SRT
                const srt = await $mapi.file.temp("srt");
                await $mapi.file.write(srt, buildSrt(cfg.script, jobResult.Audio.duration));
                jobResult.Subtitle.srt = srt;
                const sub = await VideoSubtitleRun({
                    taskId: "",
                    title: `${cfg.batchTitle} #${cfg.variant.index + 1} 字幕`,
                    video: jobResult.Render.file,
                    subtitle: srt,
                });
                jobResult.Subtitle.taskId = sub.taskId;
            }
            subtitling.add(jobResult.Subtitle.taskId);
            await TaskService.update(bizId, { status: "running", jobResult });
            let video: string | null;
            try {
                video = await subTaskResult(jobResult.Subtitle.taskId);
            } catch (e) {
                subtitling.delete(jobResult.Subtitle.taskId);
                throw e;
            }
            if (!video) return "retry";
            subtitling.delete(jobResult.Subtitle.taskId);
            jobResult.Subtitle.file = video;
            jobResult.Subtitle.status = "success";
            jobResult.step = "End";
            await TaskService.update(bizId, { jobResult });
        }

        if (jobResult.step === "End") {
            return "success";
        }
        throw `ClipMatrix.runFunc: unknown step ${jobResult.step}`;
    },
    successFunc: async (bizId, bizParam) => {
        const { record } = await serverStore.prepareForTask(bizId, bizParam);
        const jobResult: ClipMatrixJobResultType = record.jobResult;
        const file = jobResult.Subtitle?.file || jobResult.Render.file;
        await TaskService.update(bizId, {
            status: "success",
            endTime: Date.now(),
            result: { url: await DataService.saveFile(file), urlSound: jobResult.Audio.file },
        });
    },
    failFunc: async (bizId, msg) => {
        await TaskService.update(bizId, { status: "fail", statusMsg: msg, endTime: Date.now() });
    },
};
