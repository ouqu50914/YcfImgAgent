# 构建 context 必须为 Frontend 目录（与 docker-compose 中 context: ./Frontend 一致）。
# 错误示例：在仓库根目录执行 docker build -f Frontend/Dockerfile .
# 会把根目录当作 context，COPY package.json 可能不是前端清单，导致 @tiptap 等依赖未安装、vue-tsc 报 TS2307。
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package.json ./
COPY yarn.lock ./

# 安装依赖（安装后校验 TipTap 是否存在，避免错误 context 下 silent 失败到构建阶段才爆一堆 TS 错误）
RUN yarn install --frozen-lockfile \
    && test -f node_modules/@tiptap/vue-3/package.json \
    && test -f node_modules/prosemirror-state/package.json

# 复制源代码
COPY . .

# 构建生产版本
RUN yarn build

# Nginx 服务镜像
FROM nginx:alpine

# 复制构建产物到 Nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# 复制 Nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
