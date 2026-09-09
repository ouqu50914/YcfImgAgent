FROM python:3.11-slim

WORKDIR /app

# OpenCV 在 slim 镜像上需要的系统库
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY qc_web.py review_auto.py README.md ./
RUN mkdir -p uploads

ENV QC_HOST=0.0.0.0
ENV QC_PORT=8082

EXPOSE 8082

CMD ["python3", "qc_web.py"]
