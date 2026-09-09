FROM python:3.11-slim

WORKDIR /app

# 腾讯云/国内构建：换 Debian 镜像源，避免官方源过慢导致 SSH 超时
RUN set -eux; \
  if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
    sed -i 's/deb.debian.org/mirrors.cloud.tencent.com/g' /etc/apt/sources.list.d/debian.sources; \
    sed -i 's/security.debian.org/mirrors.cloud.tencent.com/g' /etc/apt/sources.list.d/debian.sources; \
  fi; \
  if [ -f /etc/apt/sources.list ]; then \
    sed -i 's/deb.debian.org/mirrors.cloud.tencent.com/g' /etc/apt/sources.list; \
    sed -i 's/security.debian.org/mirrors.cloud.tencent.com/g' /etc/apt/sources.list; \
  fi

# OpenCV headless 基础库 + 较小中文字体（避免 fonts-noto-cjk ~57MB 拖垮构建）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    fonts-wqy-zenhei \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    -i https://mirrors.aliyun.com/pypi/simple/ \
    --trusted-host mirrors.aliyun.com

COPY qc_web.py review_auto.py README.md ./
RUN mkdir -p uploads

ENV QC_HOST=0.0.0.0
ENV QC_PORT=8082
ENV PYTHONUNBUFFERED=1

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8082/', timeout=3)" || exit 1

CMD ["python3", "qc_web.py"]
