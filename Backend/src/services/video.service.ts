import { AppDataSource } from "../data-source";
import { VideoTask } from "../entities/VideoTask";
import { ApiConfig } from "../entities/ApiConfig";
import { WorkflowTemplate } from "../entities/WorkflowTemplate";
import { KlingVideoAdapter, KlingCreateTaskParams } from "../adapters/kling-video.adapter";

/** 图生视频子类型：仅首帧 / 首尾帧（一镜到底）/ 多图多镜头 */
export type ImageSubType = "first_only" | "first_last" | "multi_shot";

export interface CreateVideoTaskInput {
    mode: "text_to_video" | "image_to_video" | "omni";
    prompt: string;
    /** 工作流项目 workflow_template.id */
    templateId?: number | null;
    imageUrl?: string;
    /** 尾帧 URL，仅 imageSubType=first_last 时使用，可灵字段 image_tail */
    endImageUrl?: string;
    imageUrls?: string[];
    /** 图生视频子类型，便于 adapter 分支 */
    imageSubType?: ImageSubType;
    duration?: number;
    resolution?: "720p" | "1080p" | "4k" | string;
    aspectRatio?: string;
    style?: string;
    fps?: number;
    seed?: number;
    /** 可灵生成模式：std 标准 / pro 专家，默认 std */
    klingMode?: "std" | "pro";
}

export class VideoService {
    private videoRepo = AppDataSource.getRepository(VideoTask);
    private configRepo = AppDataSource.getRepository(ApiConfig);
    private templateRepo = AppDataSource.getRepository(WorkflowTemplate);
    private adapter = new KlingVideoAdapter();

    /**
     * 创建可灵视频任务，并在本地落盘一条 VideoTask 记录
     */
    async createTask(userId: number, input: CreateVideoTaskInput) {
        const config = await this.getKlingConfig();

        const payload: KlingCreateTaskParams = {
            mode: input.mode,
            prompt: input.prompt,
            duration: input.duration,
            resolution: input.resolution as any,
            aspectRatio: input.aspectRatio,
            style: input.style,
            fps: input.fps,
            seed: input.seed,
            klingMode: input.klingMode,
            ...(input.mode === "image_to_video" || input.mode === "omni"
                ? {
                    imageUrl: input.imageUrl,
                    endImageUrl: input.endImageUrl,
                    imageSubType: input.imageSubType,
                    ...(input.imageUrls?.length ? { imageUrls: input.imageUrls } : {}),
                }
                : {}),
        } as KlingCreateTaskParams;

        const createResult = await this.adapter.createTask(payload);

        const task = new VideoTask();
        task.user_id = userId;
        task.provider = "kling";
        task.type = input.mode;
        task.request_params = payload;
        task.provider_task_id = createResult.taskId;
        task.status = "pending";
        task.progress = 0;
        task.error_message = null;
        task.video_urls = null;
        task.finished_at = null;
        task.template_id = input.templateId != null && input.templateId > 0 ? input.templateId : null;
        task.credits_spent = null;

        await this.videoRepo.save(task);

        // 目前不在这里更新 ApiConfig.used_quota，后续可根据计费策略补充

        return task;
    }

    /**
     * 获取任务详情，并在需要时向可灵同步一次状态
     */
    async getTaskById(userId: number, id: number) {
        const task = await this.videoRepo.findOne({
            where: { id, user_id: userId },
        });
        if (!task) {
            throw new Error("视频任务不存在");
        }

        // 如果任务已结束，直接返回
        if (["succeeded", "failed", "canceled"].includes(task.status)) {
            return task;
        }

        if (!task.provider_task_id) {
            return task;
        }

        // 与可灵同步一次状态
        const status = await this.adapter.getTaskStatus(task.provider_task_id);

        task.status = status.status;
        task.progress = status.progress ?? task.progress;
        if (status.errorMessage) {
            task.error_message = status.errorMessage;
        }

        // 如果成功且还没有本地 video_urls，则尝试下载视频
        if (status.status === "succeeded" && (!task.video_urls || task.video_urls.length === 0)) {
            const remoteUrls = status.remoteVideoUrls || [];
            const localUrls: string[] = [];
            for (const u of remoteUrls) {
                if (typeof u === "string" && u.startsWith("http")) {
                    const local = await this.adapter.downloadAndSaveVideo(u);
                    localUrls.push(local);
                }
            }
            if (localUrls.length > 0) {
                task.video_urls = localUrls;
            }
            task.finished_at = new Date();
        }

        await this.videoRepo.save(task);
        return task;
    }

    /**
     * 简单的任务列表查询，按创建时间倒序
     */
    async listTasks(
        userId: number,
        opts?: { mode?: string; status?: string; take?: number; templateId?: number; from?: string; to?: string }
    ) {
        if (opts?.templateId != null && opts.templateId > 0) {
            const t = await this.templateRepo.findOne({
                where: { id: opts.templateId },
                select: ["id", "user_id"],
            });
            if (!t || Number(t.user_id) !== Number(userId)) {
                throw Object.assign(new Error("无权查看该项目下的视频记录"), { status: 403 });
            }
        }

        const qb = this.videoRepo
            .createQueryBuilder("t")
            .where("t.user_id = :userId", { userId })
            .orderBy("t.created_at", "DESC");

        if (opts?.mode) {
            qb.andWhere("t.type = :mode", { mode: opts.mode });
        }
        if (opts?.status) {
            qb.andWhere("t.status = :status", { status: opts.status });
        }
        if (opts?.templateId != null && opts.templateId > 0) {
            qb.andWhere("t.template_id = :tid", { tid: opts.templateId });
        }
        if (opts?.from) {
            qb.andWhere("t.created_at >= :from", { from: opts.from });
        }
        if (opts?.to) {
            qb.andWhere("t.created_at <= :to", { to: opts.to });
        }
        qb.take(opts?.take ?? 50);

        return qb.getMany();
    }

    /**
     * 获取可灵 API 配置：
     * 优先从 api_config 表中读取 api_type = 'kling' 的配置；
     * 如未配置，则退回使用环境变量 KLING_API_BASE_URL / KLING_API_KEY。
     */
    private async getKlingConfig(): Promise<ApiConfig | null> {
        const config = await this.configRepo.findOne({
            where: { api_type: "kling" },
        });
        if (config && config.status !== 0) {
            return config;
        }
        // 没有配置也不强制报错，因为 KlingVideoAdapter 仍然可以使用环境变量工作
        return null;
    }
}

