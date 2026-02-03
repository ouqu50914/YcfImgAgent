#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"
mkdir -p $BACKUP_DIR

# 从环境变量或docker-compose获取MySQL root密码
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-root}

docker-compose exec -T mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} ai_image_tool > $BACKUP_DIR/backup_$DATE.sql

# 保留最近7天的备份
find $BACKUP_DIR -name "backup_*.sql" -mtime +7 -delete

echo "备份完成: $BACKUP_DIR/backup_$DATE.sql"
