import "reflect-metadata"; // TypeORM 必须
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import { DataSource } from "typeorm";
import path from "path";

import { AppDataSource } from "./data-source";
import { WorkflowService } from "./services/workflow.service";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
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

// 处理尾部斜杠，使 /api/auth/login/ 能匹配 /api/auth/login
app.use((req, res, next) => {
    if (req.path.length > 1 && req.path.endsWith('/')) {
        req.url = req.path.slice(0, -1) + (req.url.slice(req.path.length) || '');
    }
    next();
});

// 健康检查端点（兼容 /health 和 /health/）
app.get(['/health', '/health/'], (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 挂载路由
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/image", imageRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/prompt", promptRoutes);
app.use("/api/layer", layerRoutes);
app.use("/api/workflow", workflowRoutes);
// 静态资源托管 (用于前端访问生成的图片)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));


// 公开/收藏模板 14 天后过期删除（每天执行一次）
function startExpiredTemplatesJob() {
    const workflowService = new WorkflowService();
    const run = () => {
        workflowService.deleteExpiredTemplates()
            .then((n) => { if (n > 0) console.log(`[cron] 已删除 ${n} 个过期工作流模板`); })
            .catch((e) => console.warn("[cron] deleteExpiredTemplates failed:", e));
    };
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
}

// 启动服务
AppDataSource.initialize()
    .then(() => {
        console.log("✅ Data Source has been initialized!");
        startExpiredTemplatesJob();
        const port = process.env.PORT || 3000;
        app.listen(port, () => {
            console.log(`🚀 Server is running on http://localhost:${port}`);
        });
    })
    .catch((err) => {
        console.error("❌ Error during Data Source initialization", err);
    });