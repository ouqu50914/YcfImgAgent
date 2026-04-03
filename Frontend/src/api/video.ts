import request from '@/utils/request.ts';

export type VideoMode = 'text_to_video' | 'image_to_video' | 'omni';

/** 图生视频子类型：仅首帧 / 首尾帧（一镜到底）/ 多图多镜头 */
export type ImageSubType = 'first_only' | 'first_last' | 'multi_shot';

export interface CreateVideoTaskParams {
  mode: VideoMode;
  prompt: string;
  imageUrl?: string;
  /** 尾帧 URL，首尾帧（一镜到底）时必填 */
  endImageUrl?: string;
  /** 多图多镜头时的图片 URL 列表 */
  imageUrls?: string[];
  /** 图生视频子类型 */
  imageSubType?: ImageSubType;
  duration?: number;
  resolution?: '720p' | '1080p' | '4k' | string;
  aspectRatio?: string;
  style?: string;
  fps?: number;
  seed?: number;
  /** 可灵模式 std / pro */
  klingMode?: 'std' | 'pro';
  /** 工作流项目 ID */
  templateId?: number;
}

export interface VideoTask {
  id: number;
  user_id: number;
  provider: string;
  type: VideoMode | string;
  request_params: any;
  provider_task_id: string | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | string;
  progress: number | null;
  error_message: string | null;
  video_urls: string[] | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export const createVideoTask = (data: CreateVideoTaskParams) => {
  return request.post('/video/tasks', data) as Promise<{ message: string; data: VideoTask }>;
};

export const getVideoTask = (id: number) => {
  return request.get(`/video/tasks/${id}`) as Promise<{ message: string; data: VideoTask }>;
};

export const listVideoTasks = (params?: {
  mode?: string;
  status?: string;
  limit?: number;
  templateId?: number;
  from?: string;
  to?: string;
}) => {
  return request.get('/video/tasks', { params }) as Promise<{ message: string; data: VideoTask[] }>;
};

