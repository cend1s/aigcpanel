import { TaskJobResultStepStatus } from "../../../service/TaskService";
import type { Clip } from "./render";
import type { Variant } from "./plan";

export type ClipMatrixModelConfigType = {
    /** 同一次批量提交的标识，列表里按批次分组显示 */
    batchId: string;
    batchTitle: string;
    variant: Variant;
    clips: Clip[];
    script: string;
    soundGenerate: SoundGenerateParamType;
    ratio: string;
    subtitle: boolean;
};

export type ClipMatrixJobResultType = {
    // 1 Audio 配音（子任务：长文本转音频）
    // 2 Render 合成画面（ffmpeg）
    // 3 Subtitle 字幕（子任务：视频添加字幕，可选）
    // 4 End
    step: "Audio" | "Render" | "Subtitle" | "End";
    Audio: { status: TaskJobResultStepStatus; taskId: string; file: string; duration: number };
    Render: { status: TaskJobResultStepStatus; file: string };
    Subtitle: { status: TaskJobResultStepStatus; taskId: string; srt: string; file: string };
};
