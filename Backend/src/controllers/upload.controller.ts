import { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import { isCosEnabled, upload as cosUpload, pathToKey } from "../services/cos.service";

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
        return res.status(500).json({ message: error.message || "上传失败" });
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
        return res.status(500).json({ message: error.message || "上传失败" });
    }
};
