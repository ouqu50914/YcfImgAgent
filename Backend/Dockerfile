FROM node:20-alpine AS builder

WORKDIR /app

# 显式复制清单（避免 context 错误时 package*.json 匹配到多份非后端清单）
COPY package.json yarn.lock ./

# 安装依赖
RUN yarn install --frozen-lockfile

# 复制源代码（context 必须为 Backend 目录，见 docker-compose.prod.yml）
COPY . .

# 防止把 Frontend 当 Backend 编译：若出现 Vue 入口或前端 api 目录，立即失败并提示
RUN test -f src/index.ts && grep -q "express" src/index.ts \
    && test ! -f src/main.ts \
    && test ! -f src/App.vue \
    && test ! -d src/api \
  || (echo "ERROR: 当前 Docker build context 不是后端 Backend 目录，或 Backend/src 被前端代码覆盖。" >&2; \
      echo "请确认 compose 中 backend.build.context 为 ./Backend，且不要在 Backend 下放 Frontend 的 src。" >&2; \
      exit 1)

# 构建 TypeScript
RUN yarn build

# 生产环境镜像
FROM node:20-alpine

WORKDIR /app

# 安装生产依赖
COPY package.json yarn.lock ./
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
