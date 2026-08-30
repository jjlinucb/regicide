import { useState } from 'react';
import type { SuitedCard } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/**
 * Mission 5's reward, sourced fix (confirmed live 2026-08-30, see legacy/party.ts's MissionReward.reaverStickerChoice
 * doc): a one-time, permanent, player-chosen pick — unlike the Mage/Guardian stickers elsewhere, which are
 * auto-applied at random the moment the mission is won. `eligible` is already filtered to reaverStickerEligible
 * cards (rank 6, Bard/Cleric/Paladin, no existing special class or sticker) by CampaignLobbyPage. Disappears once
 * resolved (a party card now carries secondClassReaver) — no "change your mind later" like Beast Companion.
 */
export function ReaverStickerPicker({
  eligible,
  isHost,
  onChoose,
}: {
  eligible: SuitedCard[];
  isHost: boolean;
  onChoose: (cardId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function choose(cardId: string) {
    setSaving(true);
    setSaveError(null);
    const res = await onChoose(cardId);
    setSaving(false);
    if (!res.ok) setSaveError(res.error);
  }

  return (
    <div className="panel legacy-panel mercenary-camp">
      <h3>🍄 Reaver Sticker</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>
        Pick one Bard, Cleric, or Paladin party member (rank 6) to permanently gain the Reaver's "Reveal and Add" —
        it keeps its own class power too. This choice is final.
      </p>

      <div className="hand-scroll">
        {eligible.map((card) => (
          <PlayingCard key={card.id} card={card} small onClick={isHost && !saving ? () => choose(card.id) : undefined} />
        ))}
      </div>

      {isHost ? (
        saveError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>{saveError}</p>
      ) : (
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>Waiting for the host to choose.</p>
      )}
    </div>
  );
}
