import { useState } from 'react';
import { CLASS_THEME, classForSuit, MERCENARY_CATALOG, mercenaryCoinsForLosses } from '@regicide/shared';
import type { MercenaryProgress, MercenaryTypeId, Suit } from '@regicide/shared';

/** The suit a catalog entry's own card belongs to — `null` for the three suitless types (19 / wild Ace / Jester). */
function mercenarySuit(id: MercenaryTypeId): Suit | null {
  const suit = id.slice(-1);
  return suit === 'H' || suit === 'D' || suit === 'C' || suit === 'S' ? suit : null;
}

export function MercenaryCamp({
  progress,
  isHost,
  onSave,
}: {
  progress: MercenaryProgress;
  isHost: boolean;
  onSave: (loadout: Partial<Record<MercenaryTypeId, number>>) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [selection, setSelection] = useState<Partial<Record<MercenaryTypeId, number>>>(progress.loadout);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);

  const budget = mercenaryCoinsForLosses(progress.lossCount);
  const totalCost = MERCENARY_CATALOG.reduce((sum, spec) => sum + spec.cost * (selection[spec.id] ?? 0), 0);

  function setQty(id: MercenaryTypeId, qty: number) {
    setSelection((prev) => ({ ...prev, [id]: qty }));
    setSaved(false);
    setSaveError(null);
  }

  async function handleSave() {
    setSaving(true);
    const res = await onSave(selection);
    setSaving(false);
    if (res.ok) setSaved(true);
    else setSaveError(res.error);
  }

  return (
    <div className="panel legacy-panel mercenary-camp">
      <h3>Mercenary Camp</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>
        {progress.lossCount} loss{progress.lossCount === 1 ? '' : 'es'} against this mission earned{' '}
        <strong>
          {budget} coin{budget === 1 ? '' : 's'}
        </strong>{' '}
        — hire mercenaries to ride along in the deck on your next attempt. Coins reset when the mission is won.
      </p>

      <div className="mercenary-list">
        {MERCENARY_CATALOG.map((spec) => {
          const suit = mercenarySuit(spec.id);
          const theme = suit ? classForSuit(suit) : CLASS_THEME.MERCENARY;
          const qty = selection[spec.id] ?? 0;
          const canAfford = totalCost + spec.cost <= budget;
          return (
            <div key={spec.id} className="mercenary-row" style={{ borderColor: theme.color }}>
              <span className="mercenary-glyph" style={{ background: theme.color }}>
                {theme.glyph}
              </span>
              <span className="mercenary-label">
                {spec.label}
                <br />
                <span style={{ color: 'var(--ink-dim)' }}>
                  {spec.cost} coin{spec.cost === 1 ? '' : 's'} · max {spec.maxQty}
                </span>
              </span>
              {isHost ? (
                <span className="mercenary-stepper">
                  <button type="button" className="btn btn-secondary" disabled={qty <= 0} onClick={() => setQty(spec.id, qty - 1)}>
                    −
                  </button>
                  <span className="mercenary-qty">{qty}</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={qty >= spec.maxQty || !canAfford}
                    onClick={() => setQty(spec.id, qty + 1)}
                  >
                    +
                  </button>
                </span>
              ) : (
                <span className="mercenary-qty">{qty}</span>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: '0.9rem', margin: 0 }}>
        Spending <strong>{totalCost}</strong> of {budget} coin{budget === 1 ? '' : 's'}.
      </p>

      {isHost ? (
        <>
          <button className="btn" onClick={handleSave} disabled={saving || saved}>
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save Loadout'}
          </button>
          {saveError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>{saveError}</p>}
        </>
      ) : (
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>
          Waiting for the host to spend the mercenary coins.
        </p>
      )}
    </div>
  );
}
