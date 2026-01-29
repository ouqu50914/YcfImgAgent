import "reflect-metadata"; // TypeORM 必须
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { DataSource } from "typeorm";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 静态资源托管 (用于前端访问生成的图片)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 数据库配置
export const AppDataSource = new DataSource({
    type: "mysql",
    // 核心修改点：使用 || 提供默认值，或者使用 ! 进行非空断言
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || "root",
    password: process.env.DB_PASSWORD || "root",
    database: process.env.DB_DATABASE || "ai_image_tool",
    
    synchronize: true, 
    logging: false,
    entities: ["src/entities/*.ts"], 
    subscribers: [],
    migrations: [],
});

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