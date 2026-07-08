# VowFrame Wedding Video

AI-assisted wedding video generation project. The app collects media, builds a video spec, renders with Remotion, and stores final MP4 outputs in OSS.

## Directory Layout

```text
backend/              FastAPI API, agent/spec/job models, OSS and ECI scheduling
frontend/ios/         React Native iOS app
renderer/remotion/    Remotion composition and render CLI
renderer/Dockerfile   ECI renderer worker image
demo/                 Demo photos, music, manifests, and HyperFrames experiments
docs/                 Product notes, QA screenshots, architecture notes, archive
scripts/              Local start/test helpers
storage/              Local development JSON store and generated outputs
```

Legacy scaffold code was moved to `docs/archive/legacy-backend-scaffold`.

## Local Backend

```bash
./scripts/start.sh
```

Default URL:

```text
http://127.0.0.1:8000
```

For the local 8001 demo:

```bash
PORT=8001 ./scripts/start.sh
```

## Tests

```bash
./scripts/test.sh
```

## Docker

API image:

```bash
docker compose up --build api
```

Renderer worker image:

```bash
docker build -f renderer/Dockerfile -t vowframe-renderer .
```

## Render Flow

```text
App/Web -> backend VideoSpec -> render job -> manifest -> ECI renderer -> OSS MP4
```

Local development can still call:

```text
POST /api/v1/render-jobs/{job_id}/remotion
```

Cloud rendering uses:

```text
POST /api/v1/render-jobs/{job_id}/eci
```
