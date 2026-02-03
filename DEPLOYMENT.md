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

## 部署步骤

1. **启动Docker容器**
   ```bash
   cd /path/to/YcfImgAgent
   docker-compose -f docker-compose.prod.yml up -d
   ```

2. **配置环境变量**
   创建 `.env` 文件或设置环境变量：
   ```bash
   ALLOWED_ORIGINS=https://ouqu.top
   JWT_SECRET=your-production-secret-key
   # ... 其他环境变量
   ```

3. **更新nginx配置**
   按照上述说明修改nginx配置文件

4. **测试nginx配置**
   ```bash
   sudo nginx -t
   ```

5. **重载nginx**
   ```bash
   sudo nginx -s reload
   # 或
   sudo systemctl reload nginx
   ```

6. **验证部署**
   - 访问 `https://ouqu.top/agent` 应该能看到前端应用
   - 检查浏览器控制台，确认API请求正常
   - 测试登录、图片生成等功能

## 注意事项

1. **端口冲突**：确保服务器上的80和3000端口没有被其他服务占用
2. **防火墙**：确保阿里云安全组允许80和443端口访问
3. **CORS配置**：后端已配置允许 `https://ouqu.top` 作为来源
4. **SSL证书**：确保HTTPS配置中的SSL证书路径正确
5. **日志查看**：如果遇到问题，可以查看nginx错误日志：
   ```bash
   sudo tail -f /var/log/nginx/error.log
   sudo tail -f /var/log/nginx/access.log
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

### 静态资源404
- 确认前端构建时base路径设置为 `/agent/`
- 检查nginx的location配置是否正确
