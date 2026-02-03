import { Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

// 配置multer存储
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = `upload_${uuidv4()}${ext}`;
        cb(null, filename);
    }
});

// 文件过滤器：只允许图片
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        cb(null, true);
    } else {
        cb(new Error('只允许上传图片文件（jpeg, jpg, png, gif, webp）'));
    }
};

export const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

/**
 * 上传单张图片
 */
export const uploadImage = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "未上传文件" });
        }

        const fileUrl = `/uploads/${req.file.filename}`;
        
        return res.status(200).json({
            message: "上传成功",
            data: {
                url: fileUrl,
                filename: req.file.filename,
                size: req.file.size
            }
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message || "上传失败" });
    }
};

/**
 * 上传多张图片
 */
export const uploadImages = async (req: Request, res: Response) => {
    try {
        if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
            return res.status(400).json({ message: "未上传文件" });
        }

        const files = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
        const uploadedFiles = files.map(file => ({
            url: `/uploads/${file.filename}`,
            filename: file.filename,
            size: file.size
        }));

        return res.status(200).json({
            message: "上传成功",
            data: {
                files: uploadedFiles,
                count: uploadedFiles.length
            }
        });
    } catch (error: any) {
        return res.status(500).json({ message: error.message || "上传失败" });
    }
};
