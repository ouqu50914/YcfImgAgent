# 美术素材自动质检（qc_web）

YcfImgAgent 侧车服务：上传效果图（可选需求图）→ GPT 自动评审 → 判定 / 分数 / 标注图 / 报告。

本目录位于 monorepo：`YcfImgAgent/services/qc_web`。工作流前端通过 Backend `/api/review` 代理调用，请勿让浏览器直连本服务。

## Docker 生产部署

已纳入根目录 `docker-compose.prod.yml` 的 `qc_web` 服务：

- 镜像内安装 flask / numpy / pillow / opencv-python-headless
- 仅 Docker 内网访问，**不要**把 8082 映射到公网
- Backend 使用 `QC_WEB_URL=http://qc_web:8082`
- Key：`QC_API_KEY` 优先，否则回退 `ACE_API_KEY`（均从根目录 `.env` 注入）

```bash
# 服务器上
cp .env.example .env   # 首次
# 编辑 .env 填入 ACE_API_KEY 或 QC_API_KEY 等
docker compose -f docker-compose.prod.yml up -d --build qc_web backend frontend
```

## 本地启动

### 推荐（读 Backend/.env.local）

在 `Backend/.env.local` 配置：

```bash
QC_WEB_URL=http://127.0.0.1:8082
QC_API_KEY=你的_acedata_key   # 可不填，则回退 ACE_API_KEY
QC_API_BASE=https://api.acedata.cloud/v1
```

一键：

```bash
# 只起 Backend（会自动起 qc_web）
cd Backend && npm run dev

# 或：qc_web + Backend + Frontend
./scripts/dev.sh

# 只起 qc_web
./scripts/start-qc-web.sh
# 或：cd Backend && npm run qc
```

### 手动

```bash
cd services/qc_web
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export API_KEY=你的_acedata_key
export API_BASE=https://api.acedata.cloud/v1
python3 qc_web.py
```

Backend 需配置：`QC_WEB_URL=http://127.0.0.1:8082`

## Docker

见仓库根目录 `docker-compose.prod.yml` 中的 `qc_web` 服务。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/upload` | multipart：`file` + `type`(eff\|req) |
| POST | `/api/review` | JSON：`{ eff_id, req_ids?: string[] }` |
| GET | `/uploads/<file>` | 上传与合成图 |

浏览器也可直接打开根路径使用自带画布（仅调试用）。
