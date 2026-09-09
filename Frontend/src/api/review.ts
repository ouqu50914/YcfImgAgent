import request from '@/utils/request.ts';

export interface ReviewParams {
    effectImageUrl: string;
    reqImageUrls?: string[];
}

export interface ReviewResultData {
    verdict: string;
    weightedTotal: number | string | null;
    passLine: number | string | null;
    vetoHits: string[];
    annotatedUrl: string | null;
    summaryImageUrl: string | null;
    boxCount: number;
    reportHtml: string;
}

export const runImageReview = (data: ReviewParams) => {
    return request.post<{ message: string; data: ReviewResultData }>('/review', data, {
        // 质检约 1–3 分钟，与全局 10 分钟超时一致；失败由节点自行提示
        timeout: 600000,
        silentErrorToast: true,
    });
};
