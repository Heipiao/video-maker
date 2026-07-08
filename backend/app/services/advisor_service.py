from app.models.asset import AssetType
from app.schemas import AdvisorOption, AdvisorOptionsRequest
from app.services.asset_store import FileAssetStore


class AdvisorService:
    def __init__(self, asset_store: FileAssetStore) -> None:
        self.asset_store = asset_store

    def generate_options(self, request: AdvisorOptionsRequest) -> list[AdvisorOption]:
        assets = [self.asset_store.get(asset_id) for asset_id in request.asset_ids]
        photo_count = len([asset for asset in assets if asset.type in {AssetType.photo, AssetType.video}])
        has_music = any(asset.type == AssetType.music for asset in assets)
        place = f" in {request.location}" if request.location else ""
        date = f" on {request.wedding_date}" if request.wedding_date else ""
        context = f"{request.couple_names}{date}{place}"

        return [
            AdvisorOption(
                id="warm_cinematic",
                title="Warm Cinematic Story",
                description="A gentle emotional opening with vows, family, and a soft final title.",
                template_id="classic_wedding",
                aspect_ratio="9:16",
                primary_color="#C9A86A",
                photo_motion="slow_zoom",
                transition="crossfade",
                music_volume=0.72,
                prompt=(
                    f"Create a warm cinematic wedding reel for {context}. "
                    "Use emotional captions, slow zooms, family moments, ceremony details, and a sincere ending."
                ),
                highlights=[
                    f"{photo_count} visual assets",
                    "Soft emotional pacing",
                    "Best for vows and family memory",
                    "Music included" if has_music else "Add music for a stronger export",
                ],
            ),
            AdvisorOption(
                id="modern_editorial",
                title="Modern Editorial Cut",
                description="Clean type, faster pacing, and polished social-first sequencing.",
                template_id="modern_story",
                aspect_ratio="9:16",
                primary_color="#F4D35E",
                photo_motion="pan_left",
                transition="fade",
                music_volume=0.68,
                prompt=(
                    f"Create a modern editorial wedding reel for {context}. "
                    "Use concise captions, clean transitions, strong couple portraits, and an elegant social ending."
                ),
                highlights=[
                    f"{photo_count} visual assets",
                    "Clean editorial layout",
                    "Best for Instagram/TikTok",
                    "Moderate music bed",
                ],
            ),
            AdvisorOption(
                id="family_memory",
                title="Family Memory Film",
                description="Slower pacing focused on parents, friends, and personal details.",
                template_id="classic_wedding",
                aspect_ratio="9:16",
                primary_color="#D9E0C6",
                photo_motion="still",
                transition="crossfade",
                music_volume=0.62,
                prompt=(
                    f"Create a family-centered wedding memory film for {context}. "
                    "Prioritize parents, friends, candid reactions, handwritten details, and a grateful ending."
                ),
                highlights=[
                    "Emotional family-first structure",
                    "Less motion, more readable moments",
                    "Best for ceremony and reception screens",
                    "Gentle music mix",
                ],
            ),
        ]
