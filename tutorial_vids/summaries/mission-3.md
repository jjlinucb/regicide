# Mission 3 — Lessons in Flames

## Story
The staff of a magic academy turn out to be part of the problem, and the party has to deal with them directly.

## How it plays / special rules
- One existing party member is unavailable for this mission (sidelined by the story).
- **End of every turn:** the top card of the reserve deck flips face-up into a shared "mission zone." The enemy becomes immune to whatever class that card belongs to — and this stacks as more cards pile up. A corrupted card of that class still ignores the new immunity.
- When the enemy is defeated, the whole mission zone is banished. On an exact kill, you get to save one card from the zone into the discard pile before the rest are banished.
- Defeating an enemy skips the end-of-turn flip that turn; yielding still triggers it as normal.

## Reward
**New class — Mage:** ten new party members join, all Mages. A Mage's power resolves *before* the other class powers in an attack (Mage always goes first).

**A Mage's power (implemented, sourced from a fuller solo playthrough — Meet Me at the Table, "Mission 2 & 3 Playthrough"):** playing a Mage (or a card carrying a bonus Mage sticker) secretly reveals cards off the top of the reserve deck, one per point of the play's own attack strength. Any Jesters or corrupted cards among them are discarded straight away; the player then chooses one of the rest to tuck under the attack, adding its value to the play's own total — which every other class power in the same play (heal/draw/double-damage/reduce-strength amounts) resolves against too, not just damage. If the chosen card is itself a Mage, the reveal repeats using that Mage's own strength instead, chaining as long as Mages keep coming up. Everything revealed but not chosen falls to the discard pile. Multiple Mages in one combo'd attack each trigger their own independent reveal, at the play's own total strength. Separately, on an attack that included a Mage, a successful kill sends every card from that attack to the **banish** pile instead of the discard pile.

This replaced an earlier, oversimplified placeholder (`resolveArcaneBolts`) that just added a Mage's own printed value as flat bonus damage — a real, sourced gap this rework closes.
