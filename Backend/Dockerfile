FROM node:18-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
COPY yarn.lock ./

# 安装依赖
RUN yarn install --frozen-lockfile

# 复制源代码
COPY . .

# 构建 TypeScript
RUN yarn build

# 生产环境镜像
FROM node:18-alpine

WORKDIR /app

# 安装生产依赖
COPY package*.json ./
COPY yarn.lock ./
RUN yarn install --production --frozen-lockfile

# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src

# 创建上传目录
RUN mkdir -p uploads temp

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "dist/index.js"]
