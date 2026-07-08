# Mixkit Wedding Demo Music

Downloaded from https://mixkit.co/free-stock-music/ for local VowFrame demo use.

License note: Mixkit states on the free-stock-music page that these tracks are royalty free and can be used with no attribution or sign up required. Re-check https://mixkit.co/license/ before production distribution.

| File | Title | Artist | Duration | Tags | Wedding use |
| --- | --- | --- | ---: | --- | --- |
| `mixkit-657-wedding-01-francisco-alvear.mp3` | Wedding 01 | Francisco Alvear | 145.8s | film-score, reflective, emotional, harp, piano, wedding, nature | ceremony, vows, nostalgic_love_story, family_memory |
| `mixkit-659-romantic-francisco-alvear.mp3` | Romantic | Francisco Alvear | 158.6s | film-score, romantic, reflective, double-bass, piano, wedding, human-drama | vows, couple_portrait, ending_card, romantic_story |
| `mixkit-493-beautiful-dream-diego-nava.mp3` | Beautiful Dream | Diego Nava | 97.0s | jazz, romantic, melancholic, acoustic-guitar, drums, relaxation, love | engagement, garden_romance, soft_recap, warm_intro |
| `mixkit-614-silent-descent-eugenio-mininni.mp3` | Silent Descent | Eugenio Mininni | 160.4s | film-score, reflective, melancholic, piano, strings, cinematic, melodic | cinematic_opening, memory_sequence, family_story, slow_montage |
| `mixkit-580-sun-and-his-daughter-eugenio-mininni.mp3` | Sun and His Daughter | Eugenio Mininni | 167.8s | world, atmospheric, reflective, percussion, synth, arthouse, drama | documentary_story, travel_couple, editorial_opening, reflective_montage |
| `mixkit-587-discover-eugenio-mininni.mp3` | Discover | Eugenio Mininni | 144.0s | orchestral-pop, film-score, hopeful, reflective, piano, strings, intro, wedding | save_the_date, opening_title, wedding_intro, hopeful_montage |

## Duration Matching

Rank tracks for a target wedding video duration:

```bash
python3 demo/scripts/select_music.py --duration 40 --tags wedding,emotional,vows
```

Prepare a render-ready 40-second clip with fades:

```bash
python3 demo/scripts/prepare_music_clip.py \
  --input demo/assets/music_mixkit/mixkit-657-wedding-01-francisco-alvear.mp3 \
  --output demo/hyperframes/nostalgia_love_story_40/assets/audio/wedding-01-40s-fade.mp3 \
  --duration 40
```

Canonical metadata is in `manifest.json`.
