import { useState } from 'react';
import type { Card } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/**
 * Mission 4's Beast Companion reward, sourced from a full solo playthrough (see
 * tutorial_vids/summaries/mission-4.md): "keep the four in a box; each mission attempt you may include one in
 * your reserve deck" — a rotating pool, not four permanent recruits. The selection is sticky across missions
 * (no per-mission budget to re-validate, unlike the Mercenary Camp) — pick one, pick none, or change your mind
 * any time before starting a mission. Hidden entirely for Mission 11 (see CampaignLobbyPage), which pulls the
 * whole pool into play at once regardless of this selection.
 */
export function BeastCompanionPicker({
  pool,
  selectedId,
  isHost,
  onSave,
}: {
  pool: Card[];
  selectedId: string | null;
  isHost: boolean;
  onSave: (cardId: string | null) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function choose(cardId: string | null) {
    setSaving(true);
    setSaveError(null);
    const res = await onSave(cardId);
    setSaving(false);
    if (!res.ok) setSaveError(res.error);
  }

  return (
    <div className="panel legacy-panel mercenary-camp">
      <h3>Beast Companion</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>
        Bring one of your {pool.length} Beast Companions into the next mission's reserve deck, or leave them all in
        the box. The rest sit out this attempt.
      </p>

      <div className="hand-scroll">
        {pool.map((card) => (
          <PlayingCard
            key={card.id}
            card={card}
            small
            selected={card.id === selectedId}
            onClick={isHost && !saving ? () => choose(card.id) : undefined}
          />
        ))}
      </div>

      {isHost ? (
        <>
          <button type="button" className="btn btn-secondary" disabled={saving || selectedId === null} onClick={() => choose(null)}>
            Bring none
          </button>
          {saveError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>{saveError}</p>}
        </>
      ) : (
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>Waiting for the host to choose.</p>
      )}
    </div>
  );
}
