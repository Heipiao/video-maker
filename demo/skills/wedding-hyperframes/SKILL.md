---
name: wedding-hyperframes
description: Generate structured wedding video render plans and HyperFrames composition guidance from tagged wedding photos, story beats, and template intent. Use when working on VowFrame/wedding-video demos, tagged asset schemas, wedding slideshow templates, HyperFrames render plans, or photo-to-video scene selection.
---

# Wedding HyperFrames

Use this skill to turn wedding project data into a deterministic render plan that a HyperFrames template renderer can consume.

## Workflow

1. Read the project input JSON and identify `couple`, `event`, `story`, `assets`, and `scene_intent`.
2. Check every asset has `tags`, `moment`, `orientation`, `people`, `mood`, `quality_score`, and `caption_hint`.
3. Load `references/tag-taxonomy.md` when normalizing or adding image tags.
4. Load `references/render-plan-schema.md` before writing or changing a render plan.
5. Map scenes by intent, not by upload order:
   - opening/title: `couple`, `hero`, `engagement`
   - place/morning: `venue`, `getting_ready`, `details`
   - family/community: `family`, `friends`, `memory`
   - vows: `rings`, `vows`, `ceremony`
   - payoff/celebration: `kiss`, `reception`, `dance`, `party`
   - ending: `sendoff`, `finale`, `couple`
6. Prefer high `quality_score` photos for title, vows, kiss, and ending scenes.
7. Write `render_plan*.json` with fixed `start` and `duration` values that exactly cover the output duration.
8. Validate the render plan with:

```bash
python3 demo/skills/wedding-hyperframes/scripts/validate_render_plan.py <render_plan.json>
```

## HyperFrames Rules

- Treat HyperFrames as the renderer, not the story generator.
- Do not let LLM output free-form final HTML unless the user is prototyping.
- Keep the contract stable: structured project data -> render plan -> deterministic template renderer -> HyperFrames HTML.
- Use reusable nested compositions for title cards, photo cards, vows captions, transitions, and ending cards.
- For 9:16 output, prefer portrait images for full-frame hero layouts and use landscape images in cards or pan/crop layouts.
- Preserve the original asset id through every stage so failed renders can be traced back to source images.

## Demo Files

- Project sample: `demo/data/project.demo.json`
- Render plan sample: `demo/data/render_plan.demo.json`
- Placeholder images: `demo/assets/photos/*.svg`

## Output Standard

When creating or updating a render plan, include:

- `output.width`, `output.height`, `output.fps`, `output.duration_seconds`
- `theme.palette`, `theme.typography`, `theme.effects`
- `audio.music_track_id`, `audio.path`, `audio.volume`
- ordered `scenes`
- complete `asset_catalog`

Report validation results and any assumptions about missing tags, missing photos, or scene timing.
