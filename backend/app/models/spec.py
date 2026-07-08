from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.models.asset import Asset


class AspectRatio(StrEnum):
    landscape = "16:9"
    portrait = "9:16"
    square = "1:1"


class Transition(StrEnum):
    fade = "fade"
    crossfade = "crossfade"
    cut = "cut"


class PhotoMotion(StrEnum):
    slow_zoom = "slow_zoom"
    pan_left = "pan_left"
    pan_right = "pan_right"
    still = "still"


class CaptionPosition(StrEnum):
    bottom = "bottom"
    center = "center"
    top = "top"


class WeddingVideoStyle(BaseModel):
    font: str = Field(default="Playfair Display", min_length=1)
    primary_color: str = Field(default="#C9A86A", pattern=r"^#[0-9A-Fa-f]{6}$")
    transition: Transition = Transition.crossfade
    photo_motion: PhotoMotion = PhotoMotion.slow_zoom
    caption_position: CaptionPosition = CaptionPosition.bottom
    music_volume: float = Field(default=0.7, ge=0, le=1)


class TimelineScene(BaseModel):
    type: Literal["title", "photo", "video", "ending"]
    duration_seconds: int = Field(gt=0, le=60)
    asset_id: str | None = None
    text: str | None = None
    caption: str | None = None
    motion: PhotoMotion | None = None
    transition: Transition | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_scene_payload(self) -> "TimelineScene":
        if self.type in {"photo", "video"} and not self.asset_id:
            raise ValueError(f"{self.type} scene requires asset_id")
        if self.type in {"title", "ending"} and not self.text:
            raise ValueError(f"{self.type} scene requires text")
        return self


class WeddingVideoSpec(BaseModel):
    id: str
    template_id: str
    title: str = Field(min_length=1, max_length=120)
    aspect_ratio: AspectRatio = AspectRatio.landscape
    duration_seconds: int = Field(gt=0, le=600)
    assets: list[Asset] = Field(default_factory=list)
    music_asset_id: str | None = None
    style: WeddingVideoStyle = Field(default_factory=WeddingVideoStyle)
    timeline: list[TimelineScene] = Field(min_length=1, max_length=200)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def validate_references_and_duration(self) -> "WeddingVideoSpec":
        asset_ids = {asset.id for asset in self.assets}
        if self.music_asset_id and self.music_asset_id not in asset_ids:
            raise ValueError(f"Unknown music_asset_id: {self.music_asset_id}")
        for scene in self.timeline:
            if scene.asset_id and scene.asset_id not in asset_ids:
                raise ValueError(f"Unknown scene asset_id: {scene.asset_id}")
        total_duration = sum(scene.duration_seconds for scene in self.timeline)
        if total_duration != self.duration_seconds:
            raise ValueError("duration_seconds must equal total timeline duration")
        return self

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc)
