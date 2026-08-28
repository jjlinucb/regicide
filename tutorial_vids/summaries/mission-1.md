# Mission 1 — Call to Arms

## Story
The campaign opener. The party is summoned/confronted by the ruling council, kicking off the wider conflict the rest of the campaign follows.

## How it plays / special rules
- Cards played toward the current fight sit on your personal tableau and stay there until the enemy is beaten — they don't go to the discard pile mid-fight.
- A Paladin's strength reduction is tracked on a shared tracker rather than recalculated each time.
- **Exact-kill bonus (this mission):** defeating the enemy with exact damage sends it to the top of the reserve/draw deck instead of the discard pile.
- Whoever lands the killing blow is skipped by that enemy's retaliation and immediately acts first against the next enemy.

## Reward
**Relic — Kinfolk Flute:** two-sided. Solo side (matches this codebase's `kinfolkSlot`): once per turn, bank a 2/3/4/5 from hand into a personal storage slot (one card at a time — a new card can't go in while a different-value one is already sitting there), then later spend it as though it were still in hand while performing a Kinfolk-style attack. Co-op side (not yet confirmed against this codebase, per a solo playthrough — see `mission-2.md`'s sourced-from-video notes): once you've committed cards to an attack, other players may silently slip in a matching-rank card of their own from hand to help complete the combo, no talking, just reading the table.
- **Corrupt a card:** as part of this mission's reward, one random existing party member is permanently corrupted (`reward.corruptAnotherCard`) — the campaign's very first corrupted card.
- **New recruit — "High Arcana"** (Elf Mage flavor): a flat 25-value card with no class ability shown in a solo playthrough — straight damage/discard/defend value of 25. Implemented as an ordinary Bard-class recruit (an unsourced pick — no footage shows this card's suit) rather than folded into Mission 3's Mage mechanic, since no ability was shown for it at the point it's granted.

## Meta mechanics shown
- **Corrupting a card:** a random-selection process (by race, then a visual trait) upgrades an existing party member into a permanently stronger "corrupted" version. (Now this mission's own reward step, not just a shown-but-unused mechanic — see above.)
- **Adding a card:** some story beats simply hand the party a brand-new recruit to sleeve up and carry forward.
