# Mission 3 — Lessons in Flames

## Story
The staff of a magic academy turn out to be part of the problem, and the party has to deal with them directly.

## How it plays / special rules
- One existing party member is unavailable for this mission (sidelined by the story).
- **End of every turn:** the top card of the reserve deck flips face-up into a shared "mission zone." The enemy becomes immune to whatever class that card belongs to — and this stacks as more cards pile up. A corrupted card of that class still ignores the new immunity.
- When the enemy is defeated, the whole mission zone is banished. On an exact kill, you get to save one card from the zone into the discard pile before the rest are banished.
- Defeating an enemy skips the end-of-turn flip that turn; yielding still triggers it as normal.

## Reward
**New class — Mage:** ten new party members join, all Mages. A Mage's power resolves *before* the other class powers in an attack, and at its own card strength each time — not the attack's combined total. Multiple Mages in one attack resolve one after another, each at their own strength.

### Not yet implemented — found in a fuller solo playthrough (Meet Me at the Table, "Mission 2 & 3 Playthrough")
That video's own description of a Mage's power is more involved than this codebase's current `resolveArcaneBolts` (which just adds the Mage's own value as bonus damage): playing a Mage secretly reveals cards off the top of the reserve deck, one per point of the play's own attack strength; any Jesters or corrupted cards among them are discarded, then one of the rest is chosen and tucked under the attack, adding its value; if that chosen card is itself another Mage, the reveal repeats using that Mage's own strength instead, chaining as long as Mages keep coming up; everything not chosen goes to the discard pile. Separately, on an attack that included a Mage, a successful kill sends every card from that attack to the **banish** pile instead of the discard pile.

This is a real, sourced gap between the current implementation and the sourced mechanic, but reworking it is a larger job than what's been scoped so far — not attempted yet.
