# Backend

FastAPI service for assets, video specs, agent sessions, render jobs, OSS output, and ECI render dispatch.

## Run

From the repository root:

```bash
./scripts/start.sh
```

From this directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
VIDEO_MAKER_STORAGE_DIR=../storage uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
```

## Test

```bash
./scripts/test.sh
```

## Important Env

```env
VIDEO_MAKER_STORAGE_DIR=../storage
VIDEO_MAKER_REMOTION_COMMAND=node ../renderer/remotion/render.mjs {manifest_path} {output_path}
VIDEO_MAKER_OSS_ENABLED=true
VIDEO_MAKER_ECI_RENDERER_IMAGE=your-registry/vowframe-renderer:latest
VIDEO_MAKER_ECI_VSWITCH_ID=
VIDEO_MAKER_ECI_SECURITY_GROUP_ID=
VIDEO_MAKER_RENDER_CALLBACK_TOKEN=
```
