#!/bin/bash
# 已迁移到 scripts/backup-mysql-to-cos.sh（支持 COS 上传）
# 保留此文件仅为兼容旧 cron；新部署请使用：
#   ./scripts/backup-mysql-to-cos.sh
#   ./scripts/install-mysql-backup-cron.sh
exec "$(dirname "$0")/backup-mysql-to-cos.sh"
