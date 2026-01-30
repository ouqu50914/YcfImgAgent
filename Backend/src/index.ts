import "reflect-metadata"; // TypeORM 必须
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { DataSource } from "typeorm";
import path from "path";

import { AppDataSource } from "./data-source";
import authRoutes from "./routes/auth.routes";
import imageRoutes from "./routes/image.routes";
import adminRoutes from "./routes/admin.routes";


dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 挂载路由
app.use("/api/auth", authRoutes);
app.use("/api/image", imageRoutes);
app.use("/api/admin", adminRoutes);
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