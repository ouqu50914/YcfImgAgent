import "reflect-metadata"; // TypeORM 必须
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import { DataSource } from "typeorm";
import path from "path";

import { AppDataSource } from "./data-source";
import authRoutes from "./routes/auth.routes";
import imageRoutes from "./routes/image.routes";
import adminRoutes from "./routes/admin.routes";
import promptRoutes from "./routes/prompt.routes";
import layerRoutes from "./routes/layer.routes";
import workflowRoutes from "./routes/workflow.routes";


dotenv.config();

const app = express();

// 安全中间件
app.use(helmet());

// CORS 配置
// ALLOWED_ORIGINS 环境变量格式：用逗号分隔的域名列表，例如：https://ouqu.top,http://localhost:5173
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];
app.use(cors({
    origin: (origin, callback) => {
        // 允许没有origin的请求（如移动应用、Postman等）
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('不允许的CORS源'));
        }
    },
    credentials: true
}));

app.use(express.json());

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 挂载路由
app.use("/api/auth", authRoutes);
app.use("/api/image", imageRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/prompt", promptRoutes);
app.use("/api/layer", layerRoutes);
app.use("/api/workflow", workflowRoutes);
// 静态资源托管 (用于前端访问生成的图片)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));


// 启动服务
AppDataSource.initialize()
    .then(() => {
        console.log("✅ Data Source has been initialized!");
        app.listen(process.env.PORT, () => {
            console.log(`🚀 Server is running on http://localhost:${process.env.PORT}`);
        });
    })
    .catch((err) => {
        console.error("❌ Error during Data Source initialization", err);
    });