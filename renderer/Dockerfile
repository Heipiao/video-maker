FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        fonts-liberation \
        nodejs \
        npm \
    && rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml ./
COPY backend/app ./app
COPY renderer/remotion ./remotion

RUN pip install --upgrade pip \
    && pip install .

RUN npm ci --prefix remotion

CMD ["python", "-m", "app.worker.render_job"]
