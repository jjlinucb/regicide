import { useState } from 'react';
import type { Card, Rank } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/**
 * Mission 9's reward, John's ruling from live play 2026-09-04 (see legacy/party.ts's
 * MissionReward.mageStickerRankChoice): the player picks a RANK — 4 or 8 — and the SERVER draws a random eligible
 * card of that rank to carry the bonus Mage sticker.
 *
 * NOT a card picker, unlike Missions 5-8's Reaver/Guardian/Druid/Chanter pickers this otherwise resembles: the
 * whole point of the ruling is that the player does NOT choose which specific 4 or which specific 8 gets it. Two
 * buttons, never a row of cards to click.
 *
 * `rankOptions` comes straight from party.ts's mageStickerRankOptions — only ranks that can actually produce a
 * recipient — so three states fall out of it:
 *   • two options — the real choice.
 *   • one option — still shown as a prompt, one button, with the reason the other rank is missing. Deliberately
 *     not auto-resolved behind the player's back: this reward's failure mode is vanishing silently, and one
 *     click is a cheap price for the party seeing that it happened and who got it.
 *   • zero options — the reward is a genuine dead end. The panel stays on screen and SAYS SO rather than
 *     quietly not rendering (the server logs the same thing — see RoomManager's grantMissionReward).
 *
 * Once resolved, `awardedCardId` names the card the server's draw landed on, so the party can see the recipient
 * instead of the panel just disappearing.
 */
export function MageStickerRankPicker({
  party,
  rankOptions,
  awardedCardId,
  isHost,
  onChoose,
}: {
  party: Card[];
  rankOptions: Rank[];
  awardedCardId: string | null;
  isHost: boolean;
  onChoose: (rank: Rank) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function choose(rank: Rank) {
    setSaving(true);
    setSaveError(null);
    const res = await onChoose(rank);
    setSaving(false);
    if (!res.ok) setSaveError(res.error);
  }

  const awarded = awardedCardId ? party.find((c) => c.id === awardedCardId) : undefined;

  return (
    <div className="panel legacy-panel mercenary-camp">
      <h3>✨ Mage Sticker</h3>

      {awarded ? (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>
            {awarded.kind === 'suited' && awarded.name ? awarded.name : 'One of your cards'} was drawn from your
            rank-{awarded.kind === 'suited' ? awarded.rank : '?'} cards and permanently gains the Mage's reveal —
            on top of its own class power.
          </p>
          <div className="hand-scroll">
            <PlayingCard card={awarded} small />
          </div>
        </>
      ) : rankOptions.length === 0 ? (
        <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>
          This reward can't be granted: none of your rank-4 or rank-8 cards is eligible any more — every one of
          them is corrupted, or already carries a class of its own. Nothing was awarded.
        </p>
      ) : (
        <>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>
            Pick a rank. One <em>random</em> eligible card of that rank permanently gains the Mage's reveal, on top
            of its own class power — you choose the rank, not the card. This choice is final.
          </p>
          {rankOptions.length === 1 && (
            <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', margin: 0 }}>
              Only rank {rankOptions[0]} has an eligible member left, so that's the one rank on offer.
            </p>
          )}
          <div className="hand-scroll">
            {rankOptions.map((rank) => (
              <button key={rank} type="button" className="btn" disabled={!isHost || saving} onClick={() => choose(rank)}>
                Rank {rank}
              </button>
            ))}
          </div>
        </>
      )}

      {isHost ? (
        saveError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>{saveError}</p>
      ) : (
        !awarded &&
        rankOptions.length > 0 && (
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>Waiting for the host to choose.</p>
        )
      )}
    </div>
  );
}
