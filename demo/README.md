# Wedding HyperFrames Demo

This folder is a local POC for turning tagged wedding photo data into a HyperFrames render plan.

## Contents

- `data/project.demo.json`: sample project, story, photo tags, and scene intent.
- `data/render_plan.demo.json`: normalized render plan expected by a template renderer.
- `assets/photos_tagged_generated/*.jpg`: tag-first generated demo images referenced by the demo data.
- `data/image_generation_plan.demo.json`: the tag-to-prompt plan used to generate the demo image set.
- `assets/photos_real/*.jpg`: earlier mixed real/generated demo images, kept as fallback/reference assets.
- `assets/photos/*.svg`: original lightweight placeholders, kept as fallback assets.
- `skills/wedding-hyperframes/`: project-local Codex skill for producing render plans and HyperFrames compositions from tagged wedding assets.

## Validate

```bash
python3 demo/skills/wedding-hyperframes/scripts/validate_render_plan.py demo/data/render_plan.demo.json
```

## Intended Flow

```text
project.demo.json
  -> tagged asset selection
  -> render_plan.demo.json
  -> HyperFrames template renderer
  -> lint / inspect / render
```
