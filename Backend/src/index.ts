import "reflect-metadata"; // TypeORM 必须
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import { DataSource } from "typeorm";
import path from "path";

import { AppDataSource } from "./data-source";
import { ApiConfig } from "./entities/ApiConfig";
import { WorkflowService } from "./services/workflow.service";
import authRoutes from "./routes/auth.routes";
import userRoutes from "./routes/user.routes";
import imageRoutes from "./routes/image.routes";
import adminRoutes from "./routes/admin.routes";
import promptRoutes from "./routes/prompt.routes";
import layerRoutes from "./routes/layer.routes";
import workflowRoutes from "./routes/workflow.routes";
import videoRoutes from "./routes/video.routes";
import seedanceRoutes from "./routes/seedance.routes";
import pixverseRoutes from "./routes/pixverse.routes";
import mediaRoutes from "./routes/media.routes";
import notificationRoutes from "./routes/notification.routes";
import { isCosEnabled, getSignedUrl, pathToKey } from "./services/cos.service";
import { errorHandler } from "./middlewares/error.middleware";
import { convertJsonTimesToBeijingIso } from "./utils/beijing-time";

dotenv.config();
// 本地环境配置：.env.local 会覆盖 .env 中的同名变量（本地开发时使用）
// 生产环境下不要强行覆盖（避免把 DB_HOST/REDIS_HOST 等改成本地值）
if (process.env.NODE_ENV !== "production") {
    dotenv.config({ path: ".env.local", override: true });
}

const app = express();
const enableHsts = process.env.ENABLE_HSTS === "true";

// 安全中间件
// app.use(helmet());
app.use(
    helmet({
      hsts: enableHsts
        ? { maxAge: 31536000, includeSubDomains: true, preload: false }
        : false,
    })
  );
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

// 调大请求体大小上限，避免工作流自动保存被 100KB 默认限制拦截
// PixVerse 侧要求请求体 < 20MB，这里默认放宽到 20mb（可用 JSON_BODY_LIMIT 环境变量覆盖）。
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '20mb';
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

// 统一将 JSON 响应中的时间转换为北京时间 ISO(+08:00)
app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    (res as any).json = (body: any) => {
        try {
            return originalJson(convertJsonTimesToBeijingIso(body));
        } catch {
            return originalJson(body);
        }
    };
    next();
});

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
        timestamp: new Date(),
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
app.use("/api/video", videoRoutes);
app.use("/api/seedance", seedanceRoutes);
app.use("/api/pixverse", pixverseRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/notifications", notificationRoutes);

// 静态资源 / 腾讯云 COS 预签名重定向
app.use("/uploads", (req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || !isCosEnabled()) {
        return next();
    }
    const key = pathToKey("/uploads" + (req.path === "/" ? "" : req.path));
    if (!key) return next();
    getSignedUrl(key, 3600)
        .then((url) => res.redirect(302, url))
        .catch(() => next());
});
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// 全局错误处理中间件（需放在所有路由之后）
app.use(errorHandler);

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

/**
 * 运行时兜底：确保核心 API 配置记录存在。
 * 仅在记录缺失时插入占位配置，不覆盖管理员已配置的真实值。
 */
async function ensureApiConfigRecords() {
    const repo = AppDataSource.getRepository(ApiConfig);
    const defaults: Array<Pick<ApiConfig, "api_type" | "api_url" | "api_key" | "status" | "user_daily_limit" | "used_quota">> = [
        {
            api_type: "dream",
            api_url: process.env.DREAM_API_URL || "https://api.dream-ai.com/v1/generate",
            api_key: process.env.DREAM_API_KEY || "sk-dream-placeholder",
            status: 1,
            user_daily_limit: 20,
            used_quota: 0,
        },
        {
            api_type: "nano",
            api_url: process.env.NANO_API_URL || "https://api.nano-ai.com/v1/image",
            api_key: process.env.NANO_API_KEY || "sk-nano-placeholder",
            status: 1,
            user_daily_limit: 20,
            used_quota: 0,
        },
        {
            api_type: "midjourney",
            api_url: process.env.MIDJOURNEY_API_URL || "https://api.midjourney.com/v1",
            api_key: process.env.MIDJOURNEY_API_KEY || "sk-midjourney-placeholder",
            status: 1,
            user_daily_limit: 20,
            used_quota: 0,
        },
    ];

    for (const item of defaults) {
        const exists = await repo.findOneBy({ api_type: item.api_type });
        if (exists) continue;
        await repo.save(repo.create(item));
        console.log(`[bootstrap] 已自动补齐 API 配置: ${item.api_type}`);
    }
}

// 启动服务
AppDataSource.initialize()
    .then(async () => {
        console.log("✅ Data Source has been initialized!");
        await ensureApiConfigRecords();
        startExpiredTemplatesJob();
        const port = process.env.PORT || 3000;
        app.listen(port, () => {
            console.log(`🚀 Server is running on http://localhost:${port}`);
        });
    })
    .catch((err) => {
        console.error("❌ Error during Data Source initialization", err);
    });