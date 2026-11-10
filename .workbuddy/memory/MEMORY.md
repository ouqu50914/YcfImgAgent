# 项目长期记忆

## 部署架构
- 腾讯云（海外，免备案）部署。宿主机 nginx 反代 Docker 容器：前端 `127.0.0.1:8080`、后端 `127.0.0.1:3000`、质检 `qc_web` 仅内网 `8082`。
- 前端在 `/agent/` 路径下提供服务（`Frontend/nginx.conf` 的 `location /agent/` → alias html）。
- 域名 `artycf.com` / `www.artycf.com`。HTTPS 需在宿主机 nginx 配 `443 ssl`（Let's Encrypt 或腾讯云证书），**证书需服务器侧申请**。

## 关键配置
- 根目录 `nginx.conf` 已补全 HTTPS(443) server 块（2026-10-22）。证书路径占位 `/etc/letsencrypt/live/artycf.com/`，部署时需实际申请/校验。
- `docker-compose.prod.yml` 的 `ALLOWED_ORIGINS` 当前仅含 `www.artycf.com`，建议补 `https://artycf.com`（裸域名）。
- 服务器侧 nginx 若用「include 此 nginx.conf」方式，注意本文件自带完整 `http` 块，避免与主配置重复 `http`。
