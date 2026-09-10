#!/usr/bin/env bash
# 启动 AI 质检侧车 qc_web（从 Backend/.env / .env.local 读 Key）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QC_DIR="$ROOT/services/qc_web"
ENV_FILE="$ROOT/Backend/.env"
ENV_LOCAL="$ROOT/Backend/.env.local"
PID_FILE="$QC_DIR/.qc_web.pid"
PORT_DEFAULT=8082

load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [[ -z "$line" ]] && continue
    [[ "$line" != *=* ]] && continue
    local key="${line%%=*}"
    local val="${line#*=}"
    key="$(echo "$key" | sed 's/[[:space:]]*$//')"
    val="$(echo "$val" | sed 's/^[[:space:]]*//;s/^"//;s/"$//;s/^'\''//;s/'\''$//')"
    case "$key" in
      QC_API_KEY|QC_API_BASE|QC_WEB_URL|QC_PORT|ACE_API_KEY|ACE_API_URL|API_KEY|API_BASE|HTTPS_PROXY|HTTP_PROXY|ALL_PROXY|https_proxy|http_proxy|all_proxy)
        # 空值不覆盖已有变量（便于 QC_API_KEY 留空时回退 ACE_API_KEY）
        if [[ -n "$val" ]]; then
          export "$key=$val"
        fi
        ;;
    esac
  done < "$f"
}

load_env_file "$ENV_FILE"
load_env_file "$ENV_LOCAL"

export API_KEY="${QC_API_KEY:-${API_KEY:-${ACE_API_KEY:-}}}"
if [[ -n "${QC_API_BASE:-}" ]]; then
  export API_BASE="$QC_API_BASE"
elif [[ -n "${API_BASE:-}" ]]; then
  :
elif [[ -n "${ACE_API_URL:-}" ]]; then
  export API_BASE="${ACE_API_URL%/}/v1"
else
  export API_BASE="https://api.acedata.cloud/v1"
fi

export QC_PORT="${QC_PORT:-$PORT_DEFAULT}"
export QC_HOST="${QC_HOST:-127.0.0.1}"

if [[ -z "$API_KEY" ]]; then
  echo "[qc_web] 未配置 API Key。请在 Backend/.env.local 设置："
  echo "         QC_API_KEY=你的key"
  echo "         （或不填 QC_API_KEY，则自动使用已有的 ACE_API_KEY）"
  exit 1
fi

if lsof -nP -iTCP:"$QC_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[qc_web] 端口 ${QC_PORT} 已在监听，跳过启动"
  exit 0
fi

cd "$QC_DIR"
mkdir -p uploads

ensure_venv() {
  if [[ ! -x .venv/bin/python3 ]]; then
    echo "[qc_web] 创建虚拟环境…"
    python3 -m venv .venv
  fi
  # shellcheck disable=SC1091
  source .venv/bin/activate
}

install_deps() {
  echo "[qc_web] 检查/安装 Python 依赖…"
  # 安装依赖时优先直连国内镜像，避免本机代理拖慢/403
  local OLD_HTTPS_PROXY="${HTTPS_PROXY:-}" OLD_HTTP_PROXY="${HTTP_PROXY:-}"
  unset HTTPS_PROXY HTTP_PROXY ALL_PROXY https_proxy http_proxy all_proxy || true
  python3 -m pip install -U pip setuptools wheel >/dev/null
  if ! python3 -m pip install -r requirements.txt \
      -i https://mirrors.aliyun.com/pypi/simple/ \
      --trusted-host mirrors.aliyun.com; then
    echo "[qc_web] 阿里云镜像失败，尝试官方源…"
    [[ -n "$OLD_HTTPS_PROXY" ]] && export HTTPS_PROXY="$OLD_HTTPS_PROXY"
    [[ -n "$OLD_HTTP_PROXY" ]] && export HTTP_PROXY="$OLD_HTTP_PROXY"
    python3 -m pip install -r requirements.txt
  fi
  # 恢复代理（供后续模型 API 调用使用，由进程环境继承）
  [[ -n "$OLD_HTTPS_PROXY" ]] && export HTTPS_PROXY="$OLD_HTTPS_PROXY"
  [[ -n "$OLD_HTTP_PROXY" ]] && export HTTP_PROXY="$OLD_HTTP_PROXY"
  python3 -c "import flask, PIL, numpy"
}

ensure_venv
if ! python3 -c "import flask, PIL, numpy" 2>/dev/null; then
  install_deps
fi

echo "[qc_web] 启动中 → http://127.0.0.1:${QC_PORT}"
echo "[qc_web] API_BASE=${API_BASE}  Key=${API_KEY:0:6}…"

# 双 fork 守护化：避免 Cursor/SSH 会话结束后进程被 SIGHUP 杀掉
PY_BIN="$(command -v python3)"
if [[ -x "$QC_DIR/.venv/bin/python3" ]]; then
  PY_BIN="$QC_DIR/.venv/bin/python3"
fi
"$PY_BIN" - <<'PY' "$QC_DIR" "$PID_FILE"
import os, sys, time
qc_dir, pid_file = sys.argv[1], sys.argv[2]
log_path = os.path.join(qc_dir, "qc_web.dev.log")
script = os.path.join(qc_dir, "qc_web.py")
py = sys.executable

def daemon():
    # first fork
    if os.fork() > 0:
        return
    os.setsid()
    # second fork
    if os.fork() > 0:
        os._exit(0)
    os.chdir(qc_dir)
    fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    os.close(fd)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.close(devnull)
    with open(pid_file, "w", encoding="utf-8") as f:
        f.write(str(os.getpid()))
    os.execve(py, [py, "-u", script], os.environ.copy())

daemon()
# parent: wait briefly for pid file
for _ in range(40):
    if os.path.exists(pid_file):
        try:
            pid = int(open(pid_file).read().strip())
            os.kill(pid, 0)
            break
        except Exception:
            pass
    time.sleep(0.1)
PY

for _ in $(seq 1 40); do
  if lsof -nP -iTCP:"$QC_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[qc_web] 就绪 (pid $(cat "$PID_FILE" 2>/dev/null || echo '?'))"
    exit 0
  fi
  sleep 0.25
done

echo "[qc_web] 启动超时，请查看 $QC_DIR/qc_web.dev.log"
tail -n 40 "$QC_DIR/qc_web.dev.log" || true
exit 1
