import { useState } from 'react';
import type { SuitedCard } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/**
 * Mission 6's reward, confirmed live 2026-09-02 (see legacy/party.ts's MissionReward.guardianStickerChoice doc):
 * a one-time, permanent, player-chosen pick — like Mission 5's Reaver sticker, not auto-applied at random.
 * `eligible` is already filtered to guardianStickerEligible cards (rank 8, no existing special class or sticker)
 * by CampaignLobbyPage. Disappears once resolved (a party card now carries secondClassGuardian).
 */
export function GuardianStickerPicker({
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
      <h3>🛡 Guardian Sticker</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>
        Pick one rank-8 party member to permanently gain the Guardian's absolute shield — it keeps its own class power
        too. This choice is final.
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
