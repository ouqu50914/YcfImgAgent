# 阿里云部署配置指南

本文档说明如何在阿里云服务器上配置nginx以支持通过 `ouqu.top/agent` 访问项目。

## 部署架构

```
用户请求 ouqu.top/agent
    ↓
服务器nginx (监听443/80)
    ↓
前端容器 (localhost:80) - 提供静态文件
    ↓
前端容器nginx - 代理 /api 请求
    ↓
后端容器 (localhost:3000) - 处理API请求
```

## 服务器nginx配置

在您现有的nginx配置文件中（`/etc/nginx/nginx.conf` 或 `/etc/nginx/conf.d/*.conf`），需要在HTTP和HTTPS服务器块中添加以下配置：

### HTTP服务器配置（端口80）

在 `server` 块中添加以下location配置：

```nginx
# 前端应用 - /agent 路径
location /agent {
    proxy_pass http://localhost:80;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # WebSocket支持（如果需要）
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# API请求 - 转发到后端容器
location /api {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # 超时设置（图片生成可能需要较长时间）
    proxy_connect_timeout 120s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;
}

# 上传文件访问 - 转发到后端容器
location /uploads {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

### HTTPS服务器配置（端口443）

在HTTPS `server` 块中添加相同的location配置：

```nginx
# 前端应用 - /agent 路径
location /agent {
    proxy_pass http://localhost:80;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # WebSocket支持（如果需要）
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# API请求 - 转发到后端容器
location /api {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # 超时设置（图片生成可能需要较长时间）
    proxy_connect_timeout 120s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;
}

# 上传文件访问 - 转发到后端容器
location /uploads {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## 完整配置示例

基于您提供的nginx配置文件，完整的配置应该如下（仅显示需要添加的部分）：

### HTTP服务器块（在现有配置的location块之后添加）

```nginx
server {
    listen       80 default_server;
    listen       [::]:80 default_server;
    server_name  _;
    root         /usr/share/nginx/html;
    
    # ... 您现有的配置 ...
    
    # 新增：前端应用代理
    location /agent {
        proxy_pass http://localhost:80;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    
    # 新增：API代理
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
    
    # 新增：上传文件代理
    location /uploads {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    
    # ... 您现有的其他配置 ...
}
```

### HTTPS服务器块（同样添加上述三个location块）

## 一键上传部署（本机 → 腾讯云）

1. 首次配置：
   ```bash
   cp scripts/deploy.config.example scripts/deploy.config
   # 编辑 scripts/deploy.config：填写 DEPLOY_SSH、DEPLOY_PATH
   ```
2. 服务器上先有一份 `.env`（参考根目录 `.env.example`，含 `ACE_API_KEY` / `QC_API_KEY` 等）。
3. 之后每次发布：
   ```bash
   ./scripts/deploy.sh
   ```
   会 rsync 代码并执行 `docker compose -f docker-compose.prod.yml up -d --build`。

## 部署步骤

1. **配置环境变量**
   在项目根目录创建 `.env`（可参考 `.env.example`）：
   ```bash
   cp .env.example .env
   # 至少填写：MYSQL_*、JWT_SECRET、ALLOWED_ORIGINS、ACE_API_KEY
   # 质检：QC_API_KEY 可留空（回退 ACE_API_KEY）；QC_API_BASE 默认即可
   ```

2. **启动 / 更新 Docker 容器（含质检侧车 qc_web）**
   ```bash
   cd /path/to/YcfImgAgent
   mkdir -p data/qc_uploads Backend/uploads Backend/temp
   docker compose -f docker-compose.prod.yml up -d --build
   ```
   首次或本版更新后请带 `--build`，以便构建 `ycf_qc_web` 镜像。

3. **确认质检容器**
   ```bash
   docker ps | grep ycf_qc_web
   docker logs ycf_qc_web --tail 50
   # Backend 内访问地址由 compose 注入：QC_WEB_URL=http://qc_web:8082
   # 不要把 8082 映射到公网
   ```

4. **更新 nginx 配置**
   使用仓库根目录 `nginx.conf` 中的 server 块（或合并到现有 conf）。
   `/api` 超时已设较长（支持生图与 AI 质检 1–3 分钟）。

5. **测试 nginx 并重载**
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

6. **验证部署**
   - 打开站点前端，登录
   - 工作流：图片节点拖线 →「审核」，或右键「插入质检节点」
   - 若质检报连不上：`docker logs ycf_backend` / `docker logs ycf_qc_web`

## 注意事项

1. **端口冲突**：确保服务器上的80和3000端口没有被其他服务占用
2. **防火墙**：确保云安全组允许80和443端口访问（无需开放 8082）
3. **CORS配置**：`ALLOWED_ORIGINS` 需包含你的前端域名
4. **SSL证书**：确保HTTPS配置中的SSL证书路径正确
5. **质检 Key**：优先 `QC_API_KEY`，否则容器内回退 `ACE_API_KEY`
6. **日志查看**：
   ```bash
   sudo tail -f /var/log/nginx/error.log
   docker logs -f ycf_backend
   docker logs -f ycf_qc_web
   ```

## 故障排查

### 前端无法访问
- 检查Docker容器是否运行：`docker ps`
- 检查前端容器日志：`docker logs ycf_frontend`
- 检查nginx配置是否正确：`sudo nginx -t`

### API请求失败
- 检查后端容器是否运行：`docker logs ycf_backend`
- 检查CORS配置是否正确
- 检查后端日志中的错误信息

### 质检 ECONNREFUSED / 502
- `docker ps` 确认 `ycf_qc_web` 在运行
- Backend 环境里 `QC_WEB_URL` 必须是 `http://qc_web:8082`（compose 已注入，勿改成 127.0.0.1）
- 确认 `.env` 中有 `QC_API_KEY` 或 `ACE_API_KEY`

### 静态资源404
- 确认前端构建时base路径设置为 `/agent/`
- 检查nginx的location配置是否正确
