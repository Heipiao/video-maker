import json

import httpx

from app.core.settings import get_settings
from app.models.project import StoryDraft, WeddingProject


VIRAL_STORY_RULES = [
    "Lead with one specific, retellable human detail, not a generic wedding phrase.",
    "Make the first 3 seconds legible as a TikTok/Reels/XHS hook.",
    "Prefer candid, guest-eye, phone, camcorder, and behind-the-scenes moments over polished montage.",
    "Use nostalgia, family evidence, private vows, friend reactions, or party chaos as the emotional engine.",
    "Keep the edit vertical-first, 15-45 seconds, caption-led, and built from short fragments.",
    "Avoid empty luxury words such as timeless, elegant, cinematic, dreamy, and beautiful unless tied to a real object or moment.",
]


def fallback_story(project: WeddingProject) -> StoryDraft:
    hook = f"What made {project.couple_names}'s wedding feel like them"
    return StoryDraft(
        title=f"{project.couple_names} wedding POV",
        hook=hook,
        beats=[
            f"0-3s: Open on a real reaction from {project.location}, then place the hook as a caption.",
            "3-12s: Cut through the strongest personal evidence: old photos, vows, family hands, outfit details, or guest clips.",
            "12-28s: Build with friends, movement, and reception texture so the video feels witnessed, not staged.",
            f"28-40s: Land on a quiet payoff that makes {project.couple_names} feel specific, not generic.",
        ],
        shot_list=[
            "First look or a reaction that changes someone's face.",
            "One heirloom/detail shot with personal meaning.",
            "A shaky guest POV clip from the aisle, table, or dance floor.",
            "One audio moment: vow line, toast line, laugh, or crowd cheer.",
            "Final wide or embrace that gives the reel emotional closure.",
        ],
        missing_assets=[
            "Add one family-history or nostalgia detail if available.",
            "Add one raw guest phone clip or camcorder-style moment.",
            "Add a short text note explaining why this day felt personal.",
        ],
        platform_plan=[
            "TikTok/Reels: 9:16, 15-45s, caption hook in first frame, fast cuts before context.",
            "XHS: keep the same story but make the cover feel like a saved memory, not an ad.",
            "Private share: export a cleaner 60s version only after the social cut works.",
        ],
        edit_notes=[
            "Use captions as story, not decoration.",
            "Leave some imperfect motion and ambient audio in the edit.",
            "Do not start with venue exteriors unless they carry the story hook.",
        ],
        ending="Make it feel like a memory friends were lucky to witness.",
    )


async def generate_story(project: WeddingProject, tone: str, notes: str) -> StoryDraft:
    settings = get_settings()
    if not settings.deepseek_api_key:
        return fallback_story(project)

    prompt = {
        "video_type": project.video_type,
        "couple_names": project.couple_names,
        "wedding_date": project.wedding_date,
        "location": project.location,
        "style": project.style,
        "tone": tone,
        "notes": notes,
        "uploaded_asset_count": len(project.assets),
        "content_strategy": {
            "positioning": "Generate an emotional social wedding reel from real material, not a polished generic wedding film.",
            "platforms": ["TikTok", "Instagram Reels", "XHS", "private family share"],
            "rules": VIRAL_STORY_RULES,
        },
        "required_json_shape": {
            "title": "short string",
            "hook": "one-sentence first-frame caption, specific and retellable",
            "beats": ["4-6 timestamped edit beats"],
            "shot_list": ["5-8 concrete shots or clips to use"],
            "missing_assets": ["3-5 missing pieces that would make the video more shareable"],
            "platform_plan": ["platform-specific export/caption guidance"],
            "edit_notes": ["direct editing rules for pacing, captions, audio, and authenticity"],
            "ending": "short emotional payoff",
        },
    }
    fallback = fallback_story(project)
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
            json={
                "model": settings.deepseek_model,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are a social-first wedding short-form director for young US couples. "
                            "Find the specific human story that could make friends watch, save, and share. "
                            "Do not write generic wedding marketing copy. Return valid JSON only."
                        ),
                    },
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
                "temperature": 0.7,
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
    data = json.loads(content)
    return StoryDraft(
        title=data.get("title") or fallback.title,
        hook=data.get("hook") or fallback.hook,
        beats=data.get("beats") or fallback.beats,
        shot_list=data.get("shot_list") or fallback.shot_list,
        missing_assets=data.get("missing_assets") or fallback.missing_assets,
        platform_plan=data.get("platform_plan") or fallback.platform_plan,
        edit_notes=data.get("edit_notes") or fallback.edit_notes,
        ending=data.get("ending") or fallback.ending,
    )
