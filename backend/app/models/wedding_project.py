from enum import StrEnum


class WeddingPackageType(StrEnum):
    guest_cam_recap = "guest_cam_recap"
    wedding_story_reel = "wedding_story_reel"
    reception_screen_cut = "reception_screen_cut"


class WeddingProjectStatus(StrEnum):
    active = "active"
    archived = "archived"


class WeddingAssetSource(StrEnum):
    owner_upload = "owner_upload"
    guest_upload = "guest_upload"
