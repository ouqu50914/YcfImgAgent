#!/usr/bin/env bash
# MySQL 每日备份入口（供 cron 调用）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 从项目 .env 加载 MySQL / COS 配置
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${MYSQL_ROOT_PASSWORD:-}" ]]; then
  echo "[ERROR] 请在 $ROOT/.env 中设置 MYSQL_ROOT_PASSWORD" >&2
  exit 1
fi

mkdir -p "${LOCAL_BACKUP_DIR:-/backup/mysql}" 2>/dev/null || mkdir -p "$ROOT/backups/mysql"

cd "$ROOT/Backend"
exec yarn backup-mysql-to-cos
