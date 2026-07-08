FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app

RUN pip install --upgrade pip \
    && pip install .

RUN mkdir -p /app/storage/jobs /app/storage/outputs

EXPOSE 8017

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8017"]
