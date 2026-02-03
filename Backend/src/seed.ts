import { AppDataSource } from "./data-source";
import { ApiConfig } from "./entities/ApiConfig";
import { User } from "./entities/User";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

const seed = async () => {
    await AppDataSource.initialize();
    console.log("Database connected for seeding...");

    // 1. 创建默认超级管理员账号
    const userRepo = AppDataSource.getRepository(User);
    const adminUsername = process.env.ADMIN_USERNAME || "admin";
    const adminPassword = process.env.ADMIN_PASSWORD || "admin123456";
    
    const existingAdmin = await userRepo.findOne({ where: { username: adminUsername } });
    if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        const admin = new User();
        admin.username = adminUsername;
        admin.password = hashedPassword;
        admin.role_id = 1; // 超级管理员
        admin.status = 1; // 启用
        await userRepo.save(admin);
        console.log(`✅ 创建超级管理员账号: ${adminUsername} / ${adminPassword}`);
    } else {
        console.log(`ℹ️ 超级管理员账号已存在: ${adminUsername}`);
    }

    // 2. 初始化 API 配置
    const configRepo = AppDataSource.getRepository(ApiConfig);

    const apis = [
        {
            api_type: "dream",
            api_url: "https://api.dream-ai.com/v1/generate", // 假设的地址
            api_key: "sk-dream-placeholder",
            status: 1,
            user_daily_limit: 20
        },
        {
            api_type: "nano",
            api_url: "https://api.nano-ai.com/v1/image",     // 假设的地址
            api_key: "sk-nano-placeholder",
            status: 1,
            user_daily_limit: 20
        }
    ];

    for (const api of apis) {
        const exist = await configRepo.findOneBy({ api_type: api.api_type });
        if (!exist) {
            const newConfig = configRepo.create(api);
            await configRepo.save(newConfig);
            console.log(`✅ Seeded ${api.api_type} config`);
        } else {
            console.log(`ℹ️ ${api.api_type} already exists`);
        }
    }

    await AppDataSource.destroy();
    process.exit();
};

seed();