import request from '@/utils/request';

export interface LayerSplitResult {
  originalImageUrl: string;
  layers: Array<{
    index: number;
    url: string;
    name: string;
    type: string;
  }>;
  layerCount: number;
}

export const splitLayer = (imageUrl: string) => {
  return request.post<{ message: string; data: LayerSplitResult }>('/layer/split', {
    imageUrl
  });
};
