from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, HttpUrl


class AssetType(StrEnum):
    photo = "photo"
    video = "video"
    music = "music"


class AssetAnalysisStatus(StrEnum):
    pending = "pending"
    processing = "processing"
    ready = "ready"
    failed = "failed"
    skipped = "skipped"


class VisualAnalysis(BaseModel):
    description: str | None = None
    detected_tags: list[str] = Field(default_factory=list)
    people_count: int | None = Field(default=None, ge=0)
    mood: str | None = None
    quality_score: float | None = Field(default=None, ge=0, le=1)
    dominant_colors: list[str] = Field(default_factory=list)
    duration_seconds: float | None = Field(default=None, gt=0)
    transcript: str | None = None


class BeatMarker(BaseModel):
    time_seconds: float = Field(ge=0)
    confidence: float = Field(default=1, ge=0, le=1)
    label: str | None = None


class AudioAnalysis(BaseModel):
    description: str | None = None
    duration_seconds: float | None = Field(default=None, gt=0)
    bpm: float | None = Field(default=None, gt=0)
    energy: float | None = Field(default=None, ge=0, le=1)
    mood: str | None = None
    beat_markers: list[BeatMarker] = Field(default_factory=list)
    beat_sync_recommended: bool = False
    spectrum_summary: dict[str, Any] = Field(default_factory=dict)


class AssetAnalysis(BaseModel):
    visual: VisualAnalysis | None = None
    audio: AudioAnalysis | None = None


class Asset(BaseModel):
    id: str
    type: AssetType
    url: HttpUrl
    tag: str = Field(min_length=1, examples=["ceremony"])
    description: str | None = None
    caption: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    analysis_status: AssetAnalysisStatus = AssetAnalysisStatus.pending
    analysis: AssetAnalysis = Field(default_factory=AssetAnalysis)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
