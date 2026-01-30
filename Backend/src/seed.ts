import { AppDataSource } from "./data-source";
import { ApiConfig } from "./entities/ApiConfig";

const seed = async () => {
    await AppDataSource.initialize();
    console.log("Database connected for seeding...");

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

    process.exit();
};

seed();