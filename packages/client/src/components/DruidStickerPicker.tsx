import { useState } from 'react';
import type { SuitedCard } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/**
 * Mission 7's reward (see legacy/party.ts's MissionReward.druidStickerChoice doc): a one-time, permanent,
 * player-chosen pick, the same shape as Missions 5/6's Reaver and Guardian stickers. `eligible` is already
 * filtered to druidStickerEligible cards (the 4♦/4♣/4♠, no existing special class or sticker) by
 * CampaignLobbyPage. Disappears once resolved (a party card now carries secondClassDruid).
 */
export function DruidStickerPicker({
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
      <h3>🌱 Druid Sticker</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>
        Pick one of the 4 of Diamonds, Clubs, or Spades to permanently gain the Druid's Regrowth — it keeps its own
        class power too. This choice is final.
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
