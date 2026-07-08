from pydantic import BaseModel


class Template(BaseModel):
    id: str
    name: str
    duration_seconds: int
    aspect_ratios: list[str]
    description: str


class MusicTrack(BaseModel):
    id: str
    title: str
    mood: str
    duration_seconds: int
    license_note: str


TEMPLATES = [
    Template(
        id="nostalgia_love_story_40",
        name="Nostalgia Love Story",
        duration_seconds=40,
        aspect_ratios=["9:16"],
        description="Built around heirlooms, old photos, vows, family history, and one emotional payoff.",
    ),
    Template(
        id="modern_editorial_30",
        name="Modern Editorial",
        duration_seconds=30,
        aspect_ratios=["9:16", "16:9"],
        description="Clean type, refined pacing, and a polished social-ready wedding announcement.",
    ),
    Template(
        id="garden_romance_35",
        name="Garden Romance",
        duration_seconds=35,
        aspect_ratios=["9:16"],
        description="Soft movement, floral color, and gentle transitions for ceremony and engagement moments.",
    ),
    Template(
        id="party_recap_30",
        name="Party Recap",
        duration_seconds=30,
        aspect_ratios=["9:16"],
        description="Fast cuts, crowd reactions, dance floor energy, and a strong social finish.",
    ),
]


MUSIC_TRACKS = [
    MusicTrack(
        id="nostalgia_soft_pop",
        title="Nostalgia Soft Pop",
        mood="memory, family, old photos",
        duration_seconds=45,
        license_note="Built-in licensed placeholder. Replace with cleared production asset.",
    ),
    MusicTrack(
        id="piano_vows",
        title="Piano Vows",
        mood="emotional, ceremony, vows",
        duration_seconds=60,
        license_note="Licensed for export in generated videos.",
    ),
    MusicTrack(
        id="garden_strings",
        title="Garden Strings",
        mood="romantic, outdoor, soft",
        duration_seconds=45,
        license_note="Licensed for export in generated videos.",
    ),
    MusicTrack(
        id="reception_glow",
        title="Reception Glow",
        mood="warm, celebration, friends",
        duration_seconds=38,
        license_note="Licensed for export in generated videos.",
    ),
    MusicTrack(
        id="late_night_spark",
        title="Late Night Spark",
        mood="party, dance floor, energetic",
        duration_seconds=32,
        license_note="Licensed for export in generated videos.",
    ),
    MusicTrack(
        id="home_video_haze",
        title="Home Video Haze",
        mood="nostalgic, camcorder, intimate",
        duration_seconds=42,
        license_note="Licensed for export in generated videos.",
    ),
]
