#!/usr/bin/env bash
# 一键：本地代码 rsync 到腾讯云 → 远端 docker compose 重建并启动
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/scripts/deploy.config"
EXAMPLE="$ROOT/scripts/deploy.config.example"

if [[ ! -f "$CONFIG" ]]; then
  echo "[deploy] 缺少 $CONFIG"
  echo "[deploy] 请先执行："
  echo "  cp scripts/deploy.config.example scripts/deploy.config"
  echo "  # 编辑 deploy.config，填写 DEPLOY_SSH / DEPLOY_PATH"
  exit 1
fi

# shellcheck disable=SC1090
source "$CONFIG"

DEPLOY_SSH="${DEPLOY_SSH:-}"
DEPLOY_PATH="${DEPLOY_PATH:-}"
DEPLOY_SYNC_ENV="${DEPLOY_SYNC_ENV:-0}"
DEPLOY_COMPOSE="${DEPLOY_COMPOSE:-docker compose -f docker-compose.prod.yml}"
DEPLOY_RSYNC_OPTS="${DEPLOY_RSYNC_OPTS:-}"

if [[ -z "$DEPLOY_SSH" || -z "$DEPLOY_PATH" ]]; then
  echo "[deploy] deploy.config 中 DEPLOY_SSH / DEPLOY_PATH 不能为空"
  exit 1
fi

SSH_OPTS=(
  -o StrictHostKeyChecking=accept-new
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=120
  -o TCPKeepAlive=yes
)
if [[ -n "${DEPLOY_SSH_KEY:-}" ]]; then
  SSH_OPTS+=(-i "${DEPLOY_SSH_KEY/#\~/$HOME}")
fi

echo "[deploy] 目标: ${DEPLOY_SSH}:${DEPLOY_PATH}"

# 远端确保目录存在
ssh "${SSH_OPTS[@]}" "$DEPLOY_SSH" "mkdir -p '$DEPLOY_PATH' '$DEPLOY_PATH/data/qc_uploads' '$DEPLOY_PATH/Backend/uploads' '$DEPLOY_PATH/Backend/temp'"

RSYNC_EXCLUDES=(
  --exclude '.git/'
  --exclude '.DS_Store'
  --exclude 'node_modules/'
  --exclude 'Frontend/node_modules/'
  --exclude 'Backend/node_modules/'
  --exclude 'Frontend/dist/'
  --exclude 'Backend/dist/'
  --exclude 'Backend/uploads/'
  --exclude 'Backend/temp/'
  --exclude 'data/mysql/'
  --exclude 'data/redis/'
  --exclude 'data/qc_uploads/'
  --exclude 'services/qc_web/.venv/'
  --exclude 'services/qc_web/uploads/'
  --exclude 'services/qc_web/.qc_web.pid'
  --exclude 'services/qc_web/qc_web.dev.log'
  --exclude 'scripts/deploy.config'
  --exclude '.env'
  --exclude '.env.*'
  --exclude 'Backend/.env'
  --exclude 'Backend/.env.local'
  --exclude 'Frontend/.env'
  --exclude 'Frontend/.env.*'
  --exclude 'docs-obsidian/'
  --exclude '.cursor/'
  --exclude '.workbuddy/'
)

echo "[deploy] 同步代码…"
# trailing slash: sync contents into DEPLOY_PATH
rsync -az --delete \
  "${RSYNC_EXCLUDES[@]}" \
  $DEPLOY_RSYNC_OPTS \
  -e "ssh ${SSH_OPTS[*]}" \
  "$ROOT/" \
  "${DEPLOY_SSH}:${DEPLOY_PATH}/"

if [[ "$DEPLOY_SYNC_ENV" == "1" ]]; then
  if [[ -f "$ROOT/.env" ]]; then
    echo "[deploy] 上传根目录 .env（DEPLOY_SYNC_ENV=1）…"
    rsync -az -e "ssh ${SSH_OPTS[*]}" "$ROOT/.env" "${DEPLOY_SSH}:${DEPLOY_PATH}/.env"
  else
    echo "[deploy] 警告：本地无 .env，跳过环境文件上传"
  fi
else
  echo "[deploy] 保留服务器上的 .env（如需覆盖本地密钥，设 DEPLOY_SYNC_ENV=1）"
  ssh "${SSH_OPTS[@]}" "$DEPLOY_SSH" "test -f '$DEPLOY_PATH/.env' || { echo '[deploy] 远端缺少 .env，请先在服务器创建（可参考 .env.example）' >&2; exit 1; }"
fi

echo "[deploy] 远端构建并启动（后台执行，SSH 断开也不中断）…"
REMOTE_LOG="/tmp/ycf-deploy-build.log"
ssh "${SSH_OPTS[@]}" "$DEPLOY_SSH" "bash -s" <<EOF
set -euo pipefail
cd '$DEPLOY_PATH'
mkdir -p data/qc_uploads Backend/uploads Backend/temp
# 清掉可能卡住的旧构建日志
nohup bash -c '$DEPLOY_COMPOSE up -d --build' >'$REMOTE_LOG' 2>&1 &
echo \$! > /tmp/ycf-deploy-build.pid
echo "[deploy] 远端构建 PID=\$(cat /tmp/ycf-deploy-build.pid)，日志: $REMOTE_LOG"
EOF

echo "[deploy] 正在跟踪远端构建日志（Ctrl+C 只断开查看，不会停构建）…"
# 持续拉取日志直到 compose 结束
ssh "${SSH_OPTS[@]}" "$DEPLOY_SSH" "bash -s" <<EOF
set -euo pipefail
pid=\$(cat /tmp/ycf-deploy-build.pid 2>/dev/null || true)
logfile='$REMOTE_LOG'
touch "\$logfile"
# 跟着日志走；进程退出后多等 2 秒刷完缓冲
tail -n +1 -F "\$logfile" &
tail_pid=\$!
while kill -0 "\$pid" 2>/dev/null; do sleep 2; done
sleep 2
kill "\$tail_pid" 2>/dev/null || true
wait "\$tail_pid" 2>/dev/null || true
# 检查退出码：compose 失败时日志会有 ERROR / failed to solve
if grep -qE 'ERROR:|failed to solve|exit code: [1-9]|##\[error\]' "\$logfile"; then
  echo '[deploy] 构建失败，请检查日志末尾'
  tail -n 60 "\$logfile" || true
  exit 1
fi
echo '[deploy] 容器状态：'
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'ycf_|NAMES' || docker ps
EOF

if ! ssh "${SSH_OPTS[@]}" "$DEPLOY_SSH" "grep -qE 'ERROR:|failed to solve|exit code: [1-9]' '$REMOTE_LOG'" 2>/dev/null; then
  echo "[deploy] 完成 ✓"
  echo "[deploy] 建议检查：ssh $DEPLOY_SSH 'docker logs ycf_qc_web --tail 30'"
else
  echo "[deploy] 失败 ✗（远端构建报错，旧容器可能仍在运行）"
  echo "[deploy] 查看日志：ssh $DEPLOY_SSH 'tail -n 80 $REMOTE_LOG'"
  exit 1
fi