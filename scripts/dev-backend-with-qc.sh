#!/usr/bin/env bash
# Backend 开发启动：自动拉起 qc_web，再启动 nodemon
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

"$ROOT/scripts/start-qc-web.sh"

cd "$ROOT/Backend"
exec npm run dev:api
