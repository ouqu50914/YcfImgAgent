import Redis from "ioredis";

// 创建Redis客户端
const redisConfig: {
    host: string;
    port: number;
    password?: string;
    db: number;
} = {
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    db: 0
};

// 只在有密码时才添加 password 属性
if (process.env.REDIS_PASSWORD) {
    redisConfig.password = process.env.REDIS_PASSWORD;
}

const redis = new Redis(redisConfig);

redis.on("error", (err) => {
    console.error("Redis连接错误:", err);
});

redis.on("connect", () => {
    console.log("✅ Redis连接成功");
});

export default redis;
