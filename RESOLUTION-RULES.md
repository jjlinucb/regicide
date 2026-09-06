# Turn resolution order

Transcribed from the physical **Player Helper** card (both sides), photographed by John on
2026-09-06. This is the project's **source of truth** for the order class abilities resolve in —
it supersedes every earlier reconstruction, including orders typed from memory.

Anything the engine does that contradicts this card is a bug in the engine.

---

## The turn

> **Start of turn effects are resolved now.**

### Step 1 — Form an attack

> Play cards from your playmat to **form an attack**. *The attack strength is the combined strength
> of all cards in the attack.* Or you may instead **yield** and play no cards.

Resolving here, in this order:

| | Ability | Effect |
|---|---|---|
| | **Jester** | Anyone takes over turn, attack ignores immunity |
| A | **Animal Companion** | Play with one card, has strength of 1 |
| B | **Beast** | Play with one card, has strength of that card |
| | **Corruption** | Banish the top card of reserve, ignores immunity |
| | **Restoration** | Heal top card of banished pile, ignores immunity |

### Step 2 — Cast spells

> Resolve the **class abilities** of magic-using classes (e.g. Bards and Clerics).

| Ability | Effect |
|---|---|
| **Mage** | Look at cards from reserve, choose one to add |
| **Druid** | Deal discard pile, allocate 1 card each to 4 zones |
| **Cleric** | Heal from discard pile |
| **Bard** | Draw cards as a team |
| **Chanter** | Players draw chosen number, discard to hand limit |

### Step 3 — Deal damage

> **Deal damage** to the enemy equal to the attack strength. *Class abilities of the fighter classes
> also resolve here (e.g. Warriors).* Move the enemy's health counter down the health track.

| Ability | Effect |
|---|---|
| **Reaver** | Banish from reserve to add damage, then double |
| **Warrior** | Double damage |

> Enemy alive? **Step 4a.** Enemy defeated? **Step 4b.**

### Either Step 4a — Suffer damage

> Enemy **deals damage** equal to their strength. *Class abilities of the protector classes resolve
> here (e.g. paladins reduce damage).* **Discard** cards from hand to satisfy damage. If you can't
> satisfy damage, the mission is lost!
>
> End of turn effects are resolved now. The **next** player starts their turn.

| Ability | Effect |
|---|---|
| **Paladin** | Reduce enemy strength |
| **Guardian** | Players suffer no damage this turn |

### Or Step 4b — Enemy defeated

> 1. Follow enemy defeated step in mission rules
> 2. Clean up played cards
> 3. Turn the next enemy face up
>
> End of turn effects are **skipped**. The **same** player starts another turn.

---

## Evergreen

Printed above Step 1 on the card, because it is not a step of its own:

> **Evergreen** — a cleric, bard, warrior & paladin, ignores immunity.

An Evergreen card therefore resolves in whichever step each of those four powers belongs to: Cleric
and Bard in step 2, Warrior in step 3, Paladin in step 4a.

---

## Notes for this codebase

- The two lettered sticker slots on the card are **d = Restoration** (closing step 1) and
  **g = Chanter** (closing step 2), per John, 2026-09-06.
- "Corruption" and "Restoration" are the card's names for what the code calls
  `SuitedCard.corrupted` and `SuitedCard.restored`.
- Step 1's Animal Companion / Beast entries carry the A and B rank letters those cards print.
- Steps 4a and 4b are alternatives, not a sequence: a kill skips end-of-turn effects entirely and
  the same player continues.

---

## Engine conformance, as of 2026-09-06

| Card step | Ability | Engine | Status |
|---|---|---|---|
| 1 | Corruption, Restoration | `applyStepOneCosts`, before the Mage reveal | ✅ |
| 2 | Mage | reveal in `resolveCommittedPlay` | ✅ |
| 2 | Druid | Regrowth window opens **after damage** | ❌ out of order |
| 2 | Cleric, Bard | `resolveSuitPowers` (H, then D) | ✅ |
| 2 | Chanter | chant window opens **after damage** | ❌ out of order |
| 3 | Reaver | reveal runs **before step 2**; its doubling lands at damage | ⚠️ partly |
| 3 | Warrior | `resolveSuitPowers` (C) | ✅ |
| 4a | Paladin | `resolveSuitPowers` (S) — before damage, not after | ⚠️ harmless |
| 4a | Guardian | after the Paladin, before damage | ✅ |
| 4b | enemy defeated | `finishEnemyDefeatTail` | ✅ |

**Why the Paladin's ⚠️ is harmless:** its only effect is `spadesShield`, which is read when the enemy
attacks in step 4a. Applying it before damage rather than after is observationally identical, because
nothing between the two points reads it.

**Why the Druid and Chanter are real bugs:** both open per-player choice windows. Regrowth deals out
the discard pile and the Cleric heals from that same pile, so running Regrowth after damage instead
of before the Cleric changes what each one gets. Moving them means opening a pause mid-step-2 and
threading the damage calculation into the resume path — a restructure of
`continueResolveCommittedPlay`, not a reordering.

**The Reaver's ⚠️:** its reveal banishes cards off the reserve deck, and that currently happens
before step 2 rather than in step 3. Its damage contribution does land in step 3, so only the reveal's
timing is off.
