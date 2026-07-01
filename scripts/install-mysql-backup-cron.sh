#!/usr/bin/env bash
# 在 Linux 服务器上安装「每天凌晨 3 点 MySQL 备份到 COS」的 cron
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_SCRIPT="$ROOT/scripts/backup-mysql-to-cos.sh"
LOG_DIR="${LOCAL_BACKUP_DIR:-/backup/mysql}"
LOG_FILE="$LOG_DIR/backup.log"
CRON_LINE="0 3 * * * $BACKUP_SCRIPT >> $LOG_FILE 2>&1"

chmod +x "$BACKUP_SCRIPT"

mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR="$ROOT/backups/mysql" && mkdir -p "$LOG_DIR" && LOG_FILE="$LOG_DIR/backup.log"

if crontab -l 2>/dev/null | grep -Fq "backup-mysql-to-cos.sh"; then
  echo "cron 已存在，跳过安装："
  crontab -l | grep "backup-mysql-to-cos.sh"
  exit 0
fi

(crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -

echo "已添加 cron（每天 03:00）："
echo "  $CRON_LINE"
echo ""
echo "手动测试："
echo "  $BACKUP_SCRIPT"
echo ""
echo "查看日志："
echo "  tail -f $LOG_FILE"
