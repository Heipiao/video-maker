# Wedding Asset Tag Taxonomy

Use these tags to make image selection deterministic.

## People

- `couple`
- `bride`
- `groom`
- `family`
- `parents`
- `friends`

## Moments

- `engagement`
- `getting_ready`
- `ceremony`
- `vows`
- `rings`
- `kiss`
- `reception`
- `toast`
- `dance`
- `sendoff`

## Visual Roles

- `hero`: strong photo suitable for title or payoff.
- `establishing`: venue or environment.
- `details`: rings, dress, flowers, invitations.
- `portrait`: one-person or formal image.
- `candid`: spontaneous social image.
- `motion`: dance, walk, celebration, or blurred movement.
- `finale`: suitable ending image.

## Moods

- `warm`
- `romantic`
- `nostalgic`
- `tender`
- `emotional`
- `joyful`
- `energetic`
- `cinematic`

## Selection Rules

- Use the highest `quality_score` matching required tags for hero scenes.
- Prefer `portrait` assets for 9:16 full-frame scenes.
- Use `landscape` assets in cards, split layouts, or slow pan crops.
- Do not place low-quality or crowded photos in text-heavy scenes.
- Avoid repeating the same asset unless the repeat is intentional for a narrative callback.
