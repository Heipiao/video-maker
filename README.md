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
http://127.0.0.1:8017
```

For another local demo port:

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
docker build -f Dockerfile -t vowframe-api:dev backend
```

Renderer worker image:

```bash
docker build -f Dockerfile -t vowframe-renderer:dev renderer
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

## Cloud Internal Render Network

For production ECI rendering, keep user traffic and renderer traffic separate:

```env
VIDEO_MAKER_PUBLIC_BASE_URL=https://video-maker.aigcteacher.top
VIDEO_MAKER_RENDER_CALLBACK_BASE_URL=http://<api-private-ip-or-internal-lb>:8017
VIDEO_MAKER_OSS_ENDPOINT=https://oss-cn-hangzhou-internal.aliyuncs.com
VIDEO_MAKER_OSS_PUBLIC_BASE_URL=https://ai-video-render.oss-cn-hangzhou.aliyuncs.com
```

`VIDEO_MAKER_RENDER_CALLBACK_BASE_URL` is used only by renderer workers for
heartbeat/callback. `VIDEO_MAKER_OSS_ENDPOINT` is used for API/worker OSS
upload and download. `VIDEO_MAKER_OSS_PUBLIC_BASE_URL` is still returned to
users as the final MP4 URL.
