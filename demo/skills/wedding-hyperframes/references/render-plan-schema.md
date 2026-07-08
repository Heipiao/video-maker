# Render Plan Schema

The render plan is the stable contract between story generation, tagged photo selection, and HyperFrames template rendering.

## Required Top-Level Fields

- `render_plan_version`: integer.
- `project_id`: stable string.
- `template_id`: template key, for example `nostalgia_love_story_40`.
- `output`: dimensions, fps, duration, watermark flag.
- `theme`: palette, typography, and effects.
- `audio`: music id, path, and volume.
- `scenes`: ordered scene list.
- `asset_catalog`: tagged assets referenced by scenes.

## Scene Fields

- `id`: unique scene key.
- `start`: start time in seconds.
- `duration`: scene duration in seconds.
- `layout`: template layout key.
- `transition_out`: transition key.
- `text`: title/subtitle/caption fields.
- `assets`: list of asset ids.

## Asset Fields

- `id`: unique asset id.
- `path`: path relative to generated HyperFrames project.
- `orientation`: `portrait`, `landscape`, or `square`.
- `tags`: non-empty tag list.
- `moment`: narrative moment.
- `quality_score`: number from 0 to 1.

## Validation Rules

- Scene starts and durations must cover the declared output duration without gaps or overlaps.
- Every scene asset id must exist in `asset_catalog`.
- Every asset must include at least one tag.
- `quality_score` must be between 0 and 1.
- Watermarked preview and paid export can use the same scene plan with different output flags.
