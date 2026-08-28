# Mission 6 — Shards of Memory

## Story
Freeing captive stone guardians from their prison reveals a traitor within the party's own ranks — a companion who's secretly been working against them.

## How it plays / special rules
- Four new "Guardian" party members join. A Guardian's power fully prevents the player from taking any damage on the turn it's played.
- The traitor character is pulled from the party into a shared mission zone. When an enemy is defeated, a player chooses one card from the play area just committed to the kill and moves it permanently into that zone; the traitor then deals shared damage to the whole team equal to the zone's combined strength. Players cover it as a team, without discussing who plays what.
- **2nd-edition rules update** (official publisher errata, `Regicide Legacy - Mission 6 - QA.png`): on an exact-damage kill, a player additionally chooses any one card already in the zone — other than the traitor's own card — and discards it permanently, *before* the team-damage total above is computed. The 1st-edition printing this replaces instead just excluded that one strike's single highest-value card from the total, leaving it sitting in the zone forever after (a temporary reprieve, not a permanent shrink) — the publisher's own errata calls this out as a deliberate difficulty-easing change for the 2nd edition.
- Winning a fight with a Guardian's damage-prevention active cancels the team-damage step entirely — but NOT the exact-kill relief discard above, which the errata is explicit still happens regardless.

## Reward
**Relic — Azure Emblem:** whenever a Mage joins an attack, other players may each silently place a card from hand onto the top of the reserve deck to help stock it for later.

### Implemented
1. **The core zone-vengeance mechanic** (traitor-in-the-zone, team damage on every kill, Guardian cancels it) — built in an earlier session from the official rules card and a fan digital-reimplementation's rules doc (`legacy-missions-transcript-mismatches.md`), replacing a shipped version that auto-picked the lowest-value sacrifice and didn't implement the Guardian cancellation at all.
2. **The 2nd-edition exact-kill relief update above** — the shipped/earlier-session version excluded only the current strike's own highest-value card from the total, without ever removing it from the zone. Now a genuine player choice (any non-Myla zone card, permanently discarded) resolves via a new `AWAIT_ZONE_RELIEF_CHOICE` pause/resume window — same shape as the zone-growth choice it sits right next to — before Myla's own strike total is computed, and applies even under a Guardian (which still only cancels the team-damage step itself).

**Flagged, not implemented:** the same errata screenshot also says the team damage itself is covered by "any player, in any order, without communication" discarding from their own hand — this codebase's whole engine instead always routes every enemy attack's defend (Myla's team strike included) through the single current player's own hand only, a much deeper architectural pattern shared by every mission, not something specific to Mission 6. Multiplayer games may occasionally be unable to cover a Myla strike that a true team-wide discard could have covered. Out of scope for this pass — would need a genuinely new "any player may chip in" defend flow, not a Mission 6-specific fix.
