import { useRef, useState } from 'react';
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
  // Guards against an out-of-order save landing last when the host clicks the steppers quickly: only the newest
  // dispatched selection is allowed to write the "saved"/error state.
  const latestSave = useRef(0);

  const budget = mercenaryCoinsForLosses(progress.lossCount);
  const totalCost = MERCENARY_CATALOG.reduce((sum, spec) => sum + spec.cost * (selection[spec.id] ?? 0), 0);

  // BUG FIX (John's live report: "for mission 7, I selected 2 jesters with 10 coins, but the mission begins with
  // 2, not 4"): the picks used to live in local state until the host clicked a separate "Save Loadout" button, so
  // setting the steppers and then going straight to "Begin Mission N" silently threw the whole purchase away —
  // the server never heard about it, and the mission started with only its own base Jesters. Nothing in the UI
  // said the hires weren't committed yet. Every stepper click now commits immediately; the button is gone, and
  // the line below it just reports what the server has. The call is a full re-pick each time and re-validates
  // against the budget server-side (see RoomManager.setMercenaryLoadout), so firing it per click is safe.
  function setQty(id: MercenaryTypeId, qty: number) {
    const next = { ...selection, [id]: qty };
    setSelection(next);
    setSaved(false);
    setSaveError(null);
    void commit(next);
  }

  async function commit(loadout: Partial<Record<MercenaryTypeId, number>>) {
    const ticket = ++latestSave.current;
    setSaving(true);
    const res = await onSave(loadout);
    if (ticket !== latestSave.current) return;
    setSaving(false);
    if (res.ok) setSaved(true);
    else setSaveError(res.error);
  }

  return (
    <div className="panel legacy-panel mercenary-camp">
      <h3>Mercenary Camp</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--ink-dim)', margin: 0 }}>
        {progress.lossCount} loss{progress.lossCount === 1 ? '' : 'es'} against this mission plus a standing 15-coin
        bonus give you <strong>{budget} coins</strong> — hire mercenaries to ride along in the deck on your next
        attempt. Coins reset when the mission is won.
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
          <p style={{ fontSize: '0.85rem', color: saved ? 'var(--ink-dim)' : 'var(--ink)', margin: 0 }}>
            {saving ? 'Saving...' : saved ? 'Hired — they ride along on your next attempt.' : 'Saving...'}
          </p>
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
