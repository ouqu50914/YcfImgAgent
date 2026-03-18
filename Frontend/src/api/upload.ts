import request from '@/utils/request.ts';
import { ElMessage } from 'element-plus';

// 图片上传限制
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

const validateSingleImage = (file: File): boolean => {
    if (file.size > MAX_IMAGE_SIZE) {
        ElMessage.error('单张图片大小不能超过 10MB，请压缩后再试。');
        return false;
    }
    if (file.type && !IMAGE_TYPES.includes(file.type)) {
        ElMessage.error('仅支持 jpg、png、gif、webp 等常见图片格式。');
        return false;
    }
    return true;
};

// 上传单张图片（包含前端本地校验）
export const uploadImage = (file: File) => {
    if (!validateSingleImage(file)) {
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
    const validFiles = files.filter(file => validateSingleImage(file));
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

// 视频上传限制（仅用于视频节点）
const MAX_VIDEO_SIZE = 200 * 1024 * 1024; // 200MB

export const uploadVideo = (file: File) => {
    if (!file.type.startsWith('video/')) {
        ElMessage.error('请选择视频文件（mp4、mov 等）。');
        return Promise.reject(new Error('客户端校验失败：文件类型不是视频'));
    }
    if (file.size > MAX_VIDEO_SIZE) {
        ElMessage.error('单个视频不能超过 200MB，请压缩后再试。');
        return Promise.reject(new Error('客户端校验失败：视频过大'));
    }

    const formData = new FormData();
    formData.append('image', file);

    return request.post('/image/upload', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
};

// 音频上传限制（仅用于音频节点）
const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB

export const uploadAudio = (file: File) => {
    if (!file.type.startsWith('audio/')) {
        ElMessage.error('请选择音频文件（mp3、wav 等）。');
        return Promise.reject(new Error('客户端校验失败：文件类型不是音频'));
    }
    if (file.size > MAX_AUDIO_SIZE) {
        ElMessage.error('单个音频不能超过 50MB，请压缩后再试。');
        return Promise.reject(new Error('客户端校验失败：音频过大'));
    }

    const formData = new FormData();
    formData.append('image', file);

    return request.post('/image/upload', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
};
