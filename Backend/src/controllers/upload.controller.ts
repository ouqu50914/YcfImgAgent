import { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import { isCosEnabled, upload as cosUpload, pathToKey, getFileContent } from "../services/cos.service";

const axiosNoProxy = axios.create({ proxy: false });

const multerLimits = { fileSize: 10 * 1024 * 1024 }; // 10MB
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) cb(null, true);
    else cb(new Error("只允许上传图片文件（jpeg, jpg, png, gif, webp）"));
};

// 本地落盘（未启用 COS 时使用）
const storageDisk = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), "uploads");
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `upload_${uuidv4()}${ext}`);
    },
});

// 仅内存（启用 COS 时不落盘）
const storageMemory = multer.memoryStorage();

const uploadDisk = multer({ storage: storageDisk, fileFilter, limits: multerLimits });
const uploadMemory = multer({ storage: storageMemory, fileFilter, limits: multerLimits });

/** 按是否启用 COS 选择：COS 时用内存不落盘，否则落盘 */
export const upload = (field: string, single: boolean) => {
    return (req: Request, res: Response, next: () => void) => {
        const m = isCosEnabled() ? uploadMemory : uploadDisk;
        const mw = single ? m.single(field) : m.array(field, 10);
        mw(req, res, next);
    };
};

/**
 * 上传单张图片（启用 COS 时仅传 COS 不落盘）
 */
export const uploadImage = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "未上传文件" });
        }

        let filename: string;
        if (isCosEnabled() && req.file.buffer) {
            const ext = path.extname(req.file.originalname) || ".jpg";
            filename = `upload_${uuidv4()}${ext}`;
            const key = pathToKey(`/uploads/${filename}`);
            await cosUpload(key, req.file.buffer);
        } else {
            filename = req.file.filename;
        }

        const fileUrl = `/uploads/${filename}`;
        return res.status(200).json({
            message: "上传成功",
            data: { url: fileUrl, filename, size: req.file.size },
        });
    } catch (error: any) {
        console.error("[uploadImage]", error?.message ?? error);
        return res.status(500).json({ message: error?.message || "上传失败" });
    }
};

/**
 * 上传多张图片（启用 COS 时仅传 COS 不落盘）
 */
export const uploadImages = async (req: Request, res: Response) => {
    try {
        if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
            return res.status(400).json({ message: "未上传文件" });
        }

        const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat() as Express.Multer.File[];
        const uploadedFiles: { url: string; filename: string; size: number }[] = [];

        if (isCosEnabled()) {
            for (const file of files) {
                const ext = path.extname(file.originalname) || ".jpg";
                const filename = `upload_${uuidv4()}${ext}`;
                if (file.buffer) {
                    await cosUpload(pathToKey(`/uploads/${filename}`), file.buffer);
                    uploadedFiles.push({ url: `/uploads/${filename}`, filename, size: file.size });
                }
            }
        } else {
            for (const file of files) {
                uploadedFiles.push({
                    url: `/uploads/${file.filename}`,
                    filename: file.filename,
                    size: file.size,
                });
            }
        }

        return res.status(200).json({
            message: "上传成功",
            data: { files: uploadedFiles, count: uploadedFiles.length },
        });
    } catch (error: any) {
        console.error("[uploadImages]", error?.message ?? error);
        return res.status(500).json({ message: error?.message || "上传失败" });
    }
};

/**
 * 下载图片代理：服务端拉取图片并返回为附件，避免前端直连 CDN 被 CORS 拦截
 * GET /api/image/download?url=...  (url 可为完整 CDN 地址或 /uploads/xxx)
 */
export const downloadImage = async (req: Request, res: Response) => {
    try {
        const rawUrl = req.query.url as string;
        if (!rawUrl || typeof rawUrl !== "string") {
            return res.status(400).json({ message: "缺少参数 url" });
        }

        const decodedUrl = decodeURIComponent(rawUrl.trim());
        let buffer: Buffer;
        let suggestedName = "image.png";

        if (decodedUrl.startsWith("http://") || decodedUrl.startsWith("https://")) {
            const response = await axiosNoProxy.get(decodedUrl, { responseType: "arraybuffer" });
            buffer = Buffer.from(response.data);
            const pathSegment = new URL(decodedUrl).pathname;
            if (pathSegment) {
                const name = pathSegment.split("/").pop();
                if (name) suggestedName = name;
            }
        } else if (decodedUrl.includes("/uploads/")) {
            const pathPart = decodedUrl.startsWith("/") ? decodedUrl : `/${decodedUrl}`;
            buffer = await getFileContent(pathPart);
            const name = pathPart.split("/").pop();
            if (name) suggestedName = name;
        } else {
            return res.status(400).json({ message: "不支持的 url 格式" });
        }

        const ext = path.extname(suggestedName).toLowerCase();
        const contentType =
            [".jpg", ".jpeg"].includes(ext) ? "image/jpeg"
            : ext === ".png" ? "image/png"
            : ext === ".gif" ? "image/gif"
            : ext === ".webp" ? "image/webp"
            : "application/octet-stream";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(suggestedName)}"`);
        res.send(buffer);
    } catch (error: any) {
        console.error("[downloadImage]", error?.message || error);
        return res.status(500).json({ message: error?.message || "下载失败" });
    }
};
