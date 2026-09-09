#!/usr/bin/env bash
# 一键本地开发：qc_web + Backend + Frontend
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PIDS=()
cleanup() {
  echo ""
  echo "[dev] 正在停止子进程…"
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  # qc_web 可能是独立 pid 文件
  if [[ -f "$ROOT/services/qc_web/.qc_web.pid" ]]; then
    kill "$(cat "$ROOT/services/qc_web/.qc_web.pid")" 2>/dev/null || true
    rm -f "$ROOT/services/qc_web/.qc_web.pid"
  fi
}
trap cleanup EXIT INT TERM

"$ROOT/scripts/start-qc-web.sh"

cd "$ROOT/Backend"
npm run dev:api &
PIDS+=($!)

cd "$ROOT/Frontend"
npm run dev &
PIDS+=($!)

echo ""
echo "[dev] 已启动："
echo "  - qc_web   http://127.0.0.1:8082"
echo "  - Backend  http://127.0.0.1:3000"
echo "  - Frontend（见 Vite 输出端口，通常 5173）"
echo "按 Ctrl+C 全部停止"
echo ""

wait
