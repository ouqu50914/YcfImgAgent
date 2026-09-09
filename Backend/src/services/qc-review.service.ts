import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { detectImageFormat } from "../utils/image-format";
import { getFileContent, isCosEnabled, pathToKey, upload as cosUpload } from "./cos.service";

export type QcReviewRequest = {
    effectImageUrl: string;
    reqImageUrls?: string[];
};

export type QcReviewResult = {
    verdict: string;
    weightedTotal: number | string | null;
    passLine: number | string | null;
    vetoHits: string[];
    annotatedUrl: string | null;
    summaryImageUrl: string | null;
    boxCount: number;
    reportHtml: string;
};

function getQcWebBaseUrl(): string {
    const base = (process.env.QC_WEB_URL || "http://127.0.0.1:8082").trim().replace(/\/$/, "");
    if (!base) {
        throw new Error("未配置 QC_WEB_URL");
    }
    return base;
}

export class QcReviewService {
    private async getImageBuffer(imageUrl: string): Promise<Buffer> {
        const raw = String(imageUrl || "").trim();
        if (!raw) throw new Error("图片 URL 为空");

        if (raw.startsWith("data:image/")) {
            const m = raw.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
            if (!m?.[1]) throw new Error("无效的 base64 图片");
            return Buffer.from(m[1], "base64");
        }

        const pathPart =
            raw.startsWith("http") && raw.includes("/uploads/")
                ? new URL(raw).pathname
                : raw;

        if (pathPart.startsWith("/uploads/") || pathPart.includes("/uploads/")) {
            const normalized = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
            const uploadsIdx = normalized.indexOf("/uploads/");
            const logical = uploadsIdx >= 0 ? normalized.slice(uploadsIdx) : normalized;
            return getFileContent(logical);
        }

        if (raw.startsWith("http://") || raw.startsWith("https://")) {
            const response = await axios.get(raw, {
                responseType: "arraybuffer",
                timeout: 180000,
            });
            return Buffer.from(response.data);
        }

        const localPath = path.join(process.cwd(), raw.startsWith("/") ? raw.slice(1) : raw);
        return fs.promises.readFile(localPath);
    }

    private async saveBufferAsUpload(buffer: Buffer, prefix: string, hintPath?: string): Promise<string> {
        const detectParams: { firstBytes: Buffer; urlPathname?: string } = {
            firstBytes: buffer.subarray(0, 32),
        };
        if (hintPath) detectParams.urlPathname = hintPath;
        const detected = detectImageFormat(detectParams);
        const fileName = `${prefix}_${uuidv4()}${detected.ext || ".jpg"}`;

        if (isCosEnabled()) {
            await cosUpload(pathToKey(`/uploads/${fileName}`), buffer, detected.mime);
            return `/uploads/${fileName}`;
        }

        const uploadDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        await fs.promises.writeFile(path.join(uploadDir, fileName), buffer);
        return `/uploads/${fileName}`;
    }

    private async uploadToQcWeb(buffer: Buffer, type: "eff" | "req", filenameHint = "image.jpg"): Promise<string> {
        const form = new FormData();
        form.append("file", buffer, { filename: filenameHint, contentType: "application/octet-stream" });
        form.append("type", type);

        const base = getQcWebBaseUrl();
        const res = await axios.post(`${base}/api/upload`, form, {
            headers: form.getHeaders(),
            timeout: 120000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });

        const id = res.data?.id;
        if (!id) {
            throw new Error(res.data?.error || "qc_web 上传失败：未返回文件 id");
        }
        return String(id);
    }

    private async materializeRemoteAsset(urlOrData: string | null | undefined, prefix: string): Promise<string | null> {
        if (!urlOrData) return null;
        const v = String(urlOrData).trim();
        if (!v) return null;

        if (v.startsWith("data:image/")) {
            const buf = await this.getImageBuffer(v);
            return this.saveBufferAsUpload(buf, prefix);
        }

        if (v.startsWith("/uploads/")) {
            const base = getQcWebBaseUrl();
            const res = await axios.get(`${base}${v}`, {
                responseType: "arraybuffer",
                timeout: 120000,
            });
            return this.saveBufferAsUpload(Buffer.from(res.data), prefix, v);
        }

        if (v.startsWith("http://") || v.startsWith("https://")) {
            const res = await axios.get(v, { responseType: "arraybuffer", timeout: 120000 });
            return this.saveBufferAsUpload(Buffer.from(res.data), prefix, v);
        }

        return null;
    }

    async review(params: QcReviewRequest): Promise<QcReviewResult> {
        const effectUrl = String(params.effectImageUrl || "").trim();
        if (!effectUrl) {
            throw new Error("效果图 URL 不能为空");
        }

        const reqUrls = (params.reqImageUrls || [])
            .map((u) => String(u || "").trim())
            .filter(Boolean)
            .slice(0, 5);

        const effBuf = await this.getImageBuffer(effectUrl);
        const effId = await this.uploadToQcWeb(effBuf, "eff", "effect.jpg");

        const reqIds: string[] = [];
        for (let i = 0; i < reqUrls.length; i++) {
            const buf = await this.getImageBuffer(reqUrls[i]!);
            const id = await this.uploadToQcWeb(buf, "req", `req_${i + 1}.jpg`);
            reqIds.push(id);
        }

        const base = getQcWebBaseUrl();
        let data: any;
        try {
            const res = await axios.post(
                `${base}/api/review`,
                { eff_id: effId, req_ids: reqIds },
                { timeout: 600000, headers: { "Content-Type": "application/json" } }
            );
            data = res.data;
        } catch (err: any) {
            const msg =
                err?.response?.data?.error ||
                err?.response?.data?.message ||
                err?.message ||
                "质检服务调用失败";
            throw new Error(String(msg));
        }

        if (data?.error) {
            throw new Error(String(data.error));
        }

        const annotatedUrl = await this.materializeRemoteAsset(data.annotated, "qc_anno");
        const summaryImageUrl = await this.materializeRemoteAsset(data.summary_image, "qc_summary");

        return {
            verdict: String(data.verdict || ""),
            weightedTotal: data.weighted_total ?? null,
            passLine: data.pass_line ?? null,
            vetoHits: Array.isArray(data.veto_hits) ? data.veto_hits.map(String) : [],
            annotatedUrl,
            summaryImageUrl,
            boxCount: Number(data.box_count || 0),
            reportHtml: String(data.report_html || ""),
        };
    }
}
