# Music Sourcing and Market Notes

## Market Read

The closest market category for VowFrame is stock music / royalty-free music, not general music streaming.

- Stock music: public market-report snapshots put the category around USD 1.45-1.5B in 2024, with projections around USD 2.4-3.0B by 2030-2033.
- Royalty-free music: public report snapshots put the category around USD 1.43B in 2024, USD 1.52B in 2025, and around USD 2.03B by 2030.
- Broader music licensing services are larger, but less directly comparable because they include sync, master, public performance, enterprise licensing, and other rights workflows.

Sources checked:

- https://www.globenewswire.com/news-release/2026/02/16/3238589/0/en/stock-music-research-report-2025-market-to-reach-2-4-billion-by-2030-from-1-45-billion-in-2024-with-shutterstock-artlist-getty-images-musicbed-and-epidemic-sound-leading.html
- https://www.skyquestt.com/report/stock-music-market
- https://www.globenewswire.com/news-release/2025/03/14/3042948/28124/en/opportunities-in-the-royalty-free-music-market-2025-2030-leveraging-ai-and-strategic-partnerships-is-key-to-driving-growth-in-the-evolving-digital-music-industry.html
- https://www.businessresearchinsights.com/market-reports/music-licensing-services-market-124420

## Current Demo Source

Mixkit is suitable for prototype sourcing because its free-stock-music page states tracks are royalty free and can be used with no attribution or sign up required.

Source:

- https://mixkit.co/free-stock-music/
- https://mixkit.co/license/

Keep the current local manifest as the source of truth:

- `demo/assets/music_mixkit/manifest.json`

## Duration Matching Logic

For generated wedding videos, do not require music source duration to exactly match the video duration. Most useful stock tracks are 90-180 seconds.

Use this sequence:

1. Rank tracks by requested tags and whether `duration_seconds >= video_duration`.
2. Prefer tracks that can be trimmed instead of looped.
3. Trim the selected track to the exact render duration.
4. Apply fade-in and fade-out during preprocessing.
5. Reference the render-ready clipped file from HyperFrames.

Implemented helpers:

```bash
python3 demo/scripts/select_music.py --duration 40 --tags wedding,emotional,vows

python3 demo/scripts/prepare_music_clip.py \
  --input demo/assets/music_mixkit/mixkit-657-wedding-01-francisco-alvear.mp3 \
  --output demo/hyperframes/nostalgia_love_story_40/assets/audio/wedding-01-40s-fade.mp3 \
  --duration 40
```

## Recommended Product Contract

```json
{
  "music_track_id": "mixkit-657",
  "target_duration_seconds": 40,
  "required_tags": ["wedding", "emotional", "vows"],
  "volume": 0.82,
  "fade_in_seconds": 1.2,
  "fade_out_seconds": 3.5,
  "allow_trim": true,
  "allow_loop": false
}
```

The render worker should store the original licensed source, the processed clip, and the exact metadata used for selection.
