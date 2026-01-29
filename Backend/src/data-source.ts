import "reflect-metadata";
import { DataSource } from "typeorm";
import dotenv from "dotenv";
import { User } from "./entities/User";
import { ApiConfig } from "./entities/ApiConfig";
import { ImageResult } from "./entities/ImageResult";

dotenv.config();

export const AppDataSource = new DataSource({
    type: "mysql",
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || "root",
    password: process.env.DB_PASSWORD || "root",
    database: process.env.DB_DATABASE || "ai_image_tool",
    synchronize: true,
    logging: false,
    // 这里显式引入实体类，比用字符串路径更稳定，且避免打包后的路径问题
    entities: [User, ApiConfig, ImageResult], 
    subscribers: [],
    migrations: [],
});