import { Request, Response } from "express";
import { QcReviewService } from "../services/qc-review.service";

const service = new QcReviewService();

/**
 * POST /api/review
 * body: { effectImageUrl: string, reqImageUrls?: string[] }
 */
export const runReview = async (req: Request, res: Response) => {
    try {
        const effectImageUrl = String(req.body?.effectImageUrl || "").trim();
        const reqImageUrls = Array.isArray(req.body?.reqImageUrls)
            ? req.body.reqImageUrls.map((u: unknown) => String(u || "").trim()).filter(Boolean)
            : [];

        if (!effectImageUrl) {
            return res.status(400).json({ message: "效果图 URL 不能为空" });
        }

        const data = await service.review({ effectImageUrl, reqImageUrls });
        return res.status(200).json({ message: "质检完成", data });
    } catch (error: any) {
        const msg = error?.message || "AI 质检失败";
        const status =
            /未配置 QC_WEB_URL|ECONNREFUSED|connect|质检服务/i.test(String(msg)) ? 502 : 500;
        console.error("[runReview]", msg);
        return res.status(status).json({ message: msg });
    }
};
