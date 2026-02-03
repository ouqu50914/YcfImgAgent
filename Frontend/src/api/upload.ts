import request from '@/utils/request.ts';
import type { UploadFile } from 'element-plus';

// 上传单张图片
export const uploadImage = (file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    
    return request.post('/image/upload', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
};

// 上传多张图片
export const uploadImages = (files: File[]) => {
    const formData = new FormData();
    files.forEach(file => {
        formData.append('images', file);
    });
    
    return request.post('/image/upload/multiple', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
};
