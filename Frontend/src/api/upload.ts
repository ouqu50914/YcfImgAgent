import request from '@/utils/request.ts';
import { ElMessage } from 'element-plus';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB，与后端保持一致
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

const validateSingleFile = (file: File): boolean => {
    if (file.size > MAX_IMAGE_SIZE) {
        ElMessage.error('单张图片大小不能超过 10MB，请压缩后再试。');
        return false;
    }
    if (file.type && !ALLOWED_TYPES.includes(file.type)) {
        ElMessage.error('仅支持 jpg、png、gif、webp 等常见图片格式。');
        return false;
    }
    return true;
};

// 上传单张图片（包含前端本地校验）
export const uploadImage = (file: File) => {
    if (!validateSingleFile(file)) {
        return Promise.reject(new Error('客户端校验失败：图片不符合要求'));
    }
    const formData = new FormData();
    formData.append('image', file);
    
    return request.post('/image/upload', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
};

// 上传多张图片（包含前端本地校验）
export const uploadImages = (files: File[]) => {
    const validFiles = files.filter(file => validateSingleFile(file));
    if (validFiles.length === 0) {
        return Promise.reject(new Error('客户端校验失败：图片不符合要求'));
    }
    const formData = new FormData();
    validFiles.forEach(file => {
        formData.append('images', file);
    });
    
    return request.post('/image/upload/multiple', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
};
