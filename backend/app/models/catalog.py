from typing import Any

from pydantic import BaseModel, Field

from app.models.spec import AspectRatio, WeddingVideoStyle


class Template(BaseModel):
    id: str
    name: str
    description: str
    default_duration_seconds: int = Field(gt=0)
    default_aspect_ratio: AspectRatio = AspectRatio.landscape
    default_style: WeddingVideoStyle = Field(default_factory=WeddingVideoStyle)
    editable_schema: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


TEMPLATES: tuple[Template, ...] = (
    Template(
        id="classic_wedding",
        name="Classic Wedding",
        description="A warm cinematic timeline for ceremony, vows, rings, and family moments.",
        default_duration_seconds=45,
        editable_schema={
            "style": {
                "font": ["Playfair Display", "Cormorant Garamond", "Inter"],
                "primary_color": "hex_color",
                "transition": ["fade", "crossfade", "cut"],
                "photo_motion": ["slow_zoom", "pan_left", "pan_right", "still"],
                "caption_position": ["bottom", "center", "top"],
                "music_volume": {"min": 0, "max": 1, "step": 0.05},
            },
            "timeline": {
                "scene_duration_seconds": {"min": 2, "max": 12},
                "scene_types": ["title", "photo", "video", "ending"],
            },
        },
        tags=["romantic", "cinematic", "photo_slideshow"],
    ),
    Template(
        id="modern_story",
        name="Modern Story",
        description="A cleaner editorial wedding film layout with bold title cards and music pacing.",
        default_duration_seconds=30,
        default_style=WeddingVideoStyle(
            font="Inter",
            primary_color="#F4D35E",
            transition="fade",
            photo_motion="pan_left",
        ),
        editable_schema={
            "style": {
                "font": ["Inter", "Playfair Display"],
                "primary_color": "hex_color",
                "transition": ["fade", "cut"],
                "photo_motion": ["pan_left", "pan_right", "still"],
                "caption_position": ["bottom", "top"],
                "music_volume": {"min": 0, "max": 1, "step": 0.05},
            },
            "timeline": {
                "scene_duration_seconds": {"min": 2, "max": 10},
                "scene_types": ["title", "photo", "video", "ending"],
            },
        },
        tags=["modern", "editorial", "social"],
    ),
)
