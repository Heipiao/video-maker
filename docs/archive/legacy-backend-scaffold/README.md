# VowFrame Backend

FastAPI backend for the wedding video MVP.

## Run

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --reload --port 8001
```

## MVP API

- `GET /health`
- `GET /templates`
- `GET /music-tracks`
- `POST /projects`
- `POST /projects/{project_id}/assets`
- `POST /projects/{project_id}/story`
- `POST /projects/{project_id}/preview`
- `POST /projects/{project_id}/exports`
- `GET /projects/{project_id}`
- `GET /exports/{job_id}/download`

Video rendering is wired through `app/services/hyperframes_renderer.py`. The current implementation writes a deterministic placeholder export manifest so the product loop can be tested before the HyperFrames render worker is attached.
