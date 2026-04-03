import request from "@/utils/request";

export interface CreatePixverseGenerationParams {
    prompt: string;
    aspect_ratio: string; // PixVerse 要求的 aspect ratio（例如 16:9 / 9.16 / 4:3 / 3:4 / 1:1）
    duration: number; // 1~15（V6 文档口径）
    quality: "540p" | "720p" | "1080p" | string;
    model?: string;
    generate_audio_switch?: boolean; // 默认 true
}

export interface CreatePixverseGenerationResponse {
    video_id: number;
    status: string;
    progress: number | null;
}

export function createPixverseGeneration(params: CreatePixverseGenerationParams) {
    return request.post<{
        message: string;
        data: CreatePixverseGenerationResponse;
    }>("/pixverse/generations", params);
}

export interface CreatePixverseImageGenerationParams {
    mode: "image_to_video_first_only";
    prompt: string;
    imageUrl?: string; // 首帧：与 OpenAPI 一致仅 img_id（单张）
    /** @deprecated 上游 img_ids 仅多图模版；普通图生请勿传 */
    imageUrls?: string[];
    aspect_ratio: string;
    duration: number;
    quality: "540p" | "720p" | "1080p" | string;
    model?: string;
    generate_audio_switch?: boolean;
}

export function createPixverseImageGeneration(params: CreatePixverseImageGenerationParams) {
    return request.post<{
        message: string;
        data: CreatePixverseGenerationResponse;
    }>("/pixverse/generations", params);
}

export interface CreatePixverseFusionGenerationParams {
    mode: "fusion_multi_subject";
    prompt: string;
    imageUrls: string[]; // 2~7
    aspect_ratio: string;
    duration: number; // UI 仍用 1~15，后端会按上游支持映射为 5/8/10
    quality: "540p" | "720p" | "1080p" | string;
    model?: string; // 后端会对 fusion 模式做版本兜底
    generate_audio_switch?: boolean;
}

export function createPixverseFusionGeneration(params: CreatePixverseFusionGenerationParams) {
    return request.post<{
        message: string;
        data: CreatePixverseGenerationResponse;
    }>("/pixverse/generations", params);
}

export interface CreatePixverseTransitionGenerationParams {
    mode: "image_to_video_first_last";
    prompt: string;
    imageUrl: string; // first frame
    endImageUrl: string; // last frame
    aspect_ratio: string;
    duration: number;
    quality: "540p" | "720p" | "1080p" | string;
    model?: string;
    generate_audio_switch?: boolean;
}

export function createPixverseTransitionGeneration(params: CreatePixverseTransitionGenerationParams) {
    return request.post<{
        message: string;
        data: CreatePixverseGenerationResponse;
    }>("/pixverse/generations", params);
}

export type PixverseTaskStatus = "pending" | "running" | "succeeded" | "failed" | string;

export interface PixverseGenerationStatus {
    status: PixverseTaskStatus;
    progress: number | null;
    videoUrl: string | null;
    errorMessage: string | null;
}

export function getPixverseGenerationStatus(videoId: number | string) {
    return request.get<{
        message: string;
        data: PixverseGenerationStatus;
    }>(`/pixverse/generations/${videoId}`);
}

