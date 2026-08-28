# Mission 2 — Shadow and Mist

## Story
An ambush by a multi-headed serpentine beast in a misty, cave-like setting.

## How it plays / special rules
- Enemies here are immune to **two** classes at once instead of one.
- Only an **exact-damage** kill actually removes an enemy — overkilling just recycles it (wounds healed) to the back of the enemy line, face down, to be fought again later.
- An exact kill lets you permanently banish the defeated enemy instead of recycling it.
- First mission where a corrupted card can come into play: playing one banishes the top card of the reserve deck, and its effect ignores whatever class immunity the enemy has — but that immunity-ignoring is limited to the corrupted card's own class power, not the whole attack.

### Confirmed against a full solo playthrough (Meet Me at the Table, "Mission 2 & 3 Playthrough")
- **Corruption setup**, done once as part of Mission 1's reward track before Mission 2 even starts: reveal a random race card and a random feature card, find the one party member matching both, and re-sleeve that card as corrupted. Matches this codebase's existing `corrupted` mechanic exactly (banish-top-of-reserve cost, immunity-ignoring limited to that card's own class power) — no changes needed there.
- **Jesters** (flavor-named "Frankie" and "Sketch" in this playthrough): playing one deals a flat 8 damage that ignores enemy immunity, then discards and fully redraws the player's hand back up to their max hand size. Matches this codebase's `CLAIM_JESTER` behavior already.
- **Overkill recycling**: confirmed the enemy goes to the back of the line with wounds healed, exactly as currently implemented.
- **Fixed, sourced from this video**: this was a *solo* (1-player) game, and it used 2 Jesters — but Legacy missions were reusing classic Regicide's own player-count table (`JESTERS_BY_PLAYER_COUNT`, `{1: 0, 2: 0, 3: 1, 4: 2}`), which gives solo **zero** Jesters. Added a Legacy-only `LEGACY_JESTER_COUNT = 2` (flat, doesn't scale down by player count) and switched `RoomManager.startLegacyMission` to it — classic Regicide's own table is untouched. 2-4 player Legacy games aren't independently confirmed beyond this one solo data point, just extrapolated as "the box's two Jesters are always both in play."
- **Added — Mission 1 reward, "High Arcana"**: a new recruit, a flat 25-value card with no class ability shown at the point it's granted — a straight damage/discard/defend value of 25. Implemented as an ordinary Bard-class recruit (unsourced suit pick) alongside a new `corruptAnotherCard: true` step also added to Mission 1's reward (see `mission-1.md`) — both sourced from this same video.

## Reward
**Dual-class stickers:** randomly select four existing party members and give each a second class icon (in addition to their first). From then on, that single card triggers both class powers whenever it's played.
