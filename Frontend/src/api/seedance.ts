import request from '@/utils/request';

export interface CreateSeedanceVideoParams {
  prompt: string;
  ratio?: string;
  duration?: number;
  resolution?: string;
  generateAudio?: boolean;
  enableWebSearch?: boolean;
}

export interface CreateSeedanceVideoResponse {
  id: string;
  task_id: string;
  status: string;
  progress?: number;
  created_at?: number;
}

export function createSeedanceGeneration(params: CreateSeedanceVideoParams) {
  return request.post<{
    message: string;
    data: CreateSeedanceVideoResponse;
  }>('/seedance/generations', params);
}

export interface SeedanceTaskStatus {
  status: string;
  progress?: string | number | null;
  videoUrl?: string | null;
  duration?: number | null;
  ratio?: string | null;
  resolution?: string | null;
  errorMessage?: string | null;
}

export function getSeedanceGenerationStatus(id: string) {
  return request.get<{
    message: string;
    data: {
      status: string;
      progress?: string | number | null;
      videoUrl?: string | null;
      duration?: number | null;
      ratio?: string | null;
      resolution?: string | null;
      errorMessage?: string | null;
    };
  }>(`/seedance/generations/${id}`);
}

export type SeedanceAdvancedAction =
  | 'text'
  | 'image_first_frame'
  | 'image_first_last'
  | 'multi_modal';

export interface CreateSeedanceAdvancedParams {
  prompt: string;
  action: SeedanceAdvancedAction;
  firstImageUrl?: string;
  lastImageUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  ratio?: string;
  duration?: number;
  resolution?: string;
  generateAudio?: boolean;
  enableWebSearch?: boolean;
}

export function createSeedanceAdvanced(params: CreateSeedanceAdvancedParams) {
  return request.post<{
    message: string;
    data: CreateSeedanceVideoResponse;
  }>('/seedance/advanced', params);
}

/** 与后端扣费一致（避免本地 VITE_* 与服务器 SEEDANCE_* 不一致导致按钮积分与实扣不符） */
export interface SeedanceBillingConfig {
  defaultDurationSeconds: number;
  creditsPerSecond: number;
}

export function getSeedanceBillingConfig() {
  return request.get<{
    message: string;
    data: SeedanceBillingConfig;
  }>('/seedance/billing-config');
}


