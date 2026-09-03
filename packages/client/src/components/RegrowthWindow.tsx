import { useState } from 'react';
import type { Card, GameAction } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/** The four destinations a Regrowth pick can send a card to, in the order the action field expects them. */
const DESTINATIONS = [
  { key: 'toHandCardId', label: 'To hand', hint: 'keep it' },
  { key: 'toBanishCardId', label: 'Banish', hint: 'gone for good' },
  { key: 'toDeckTopCardId', label: 'Top of deck', hint: 'you draw it next' },
  { key: 'toDeckBottomCardId', label: 'Bottom of deck', hint: 'saved for later' },
] as const;

type DestinationKey = (typeof DESTINATIONS)[number]['key'];

/**
 * Mission 7's Regrowth window (see GameState.druidWindow): the front-of-queue player assigns the cards dealt to
 * them from the discard pile, at most one per destination. A player dealt fewer than 4 cards assigns exactly as
 * many as they hold — the Confirm button enforces the same `min(4, dealt)` count the engine validates.
 * Anything left unassigned goes back to the discard pile.
 */
export function RegrowthWindow({
  dealt,
  myPlayerId,
  sendAction,
}: {
  dealt: Card[];
  myPlayerId: string;
  sendAction: (action: GameAction) => void;
}) {
  const [assigned, setAssigned] = useState<Partial<Record<DestinationKey, string>>>({});

  const required = Math.min(4, dealt.length);
  const assignedIds = Object.values(assigned).filter((id): id is string => Boolean(id));
  const assignedCount = assignedIds.length;

  /** Clicking a destination assigns the currently-unassigned selection, or clears that slot if already filled. */
  function assignTo(key: DestinationKey, cardId: string) {
    setAssigned((prev) => {
      const next = { ...prev };
      // A card can only sit in one slot — drop it from wherever it was before.
      for (const d of DESTINATIONS) if (next[d.key] === cardId) delete next[d.key];
      next[key] = cardId;
      return next;
    });
  }

  function clearSlot(key: DestinationKey) {
    setAssigned((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="legacy-jester-claim-banner" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
      <span>
        🪶 Regrowth — {dealt.length} card(s) from the discard pile were dealt to you. Assign {required} of them, one
        per destination. The rest go back to the discard pile.
      </span>

      <div className="hand-scroll">
        {dealt.map((card) => {
          const slot = DESTINATIONS.find((d) => assigned[d.key] === card.id);
          return (
            <div key={card.id} style={{ textAlign: 'center' }}>
              <PlayingCard
                card={card}
                small
                selected={selectedId === card.id}
                onClick={() => setSelectedId(selectedId === card.id ? null : card.id)}
              />
              {slot && <div style={{ fontSize: '0.7rem', color: 'var(--ink-dim)' }}>{slot.label}</div>}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {DESTINATIONS.map((d) => {
          const filledWith = assigned[d.key];
          const filledCard = filledWith ? dealt.find((c) => c.id === filledWith) : undefined;
          const label = filledCard
            ? `${d.label}: ${filledCard.kind === 'suited' ? filledCard.name ?? filledCard.rank : 'Jester'}`
            : `${d.label} (${d.hint})`;
          return (
            <button
              key={d.key}
              type="button"
              className={filledWith ? 'btn' : 'btn btn-secondary'}
              disabled={!filledWith && !selectedId}
              onClick={() => {
                if (filledWith) return clearSlot(d.key);
                if (selectedId) {
                  assignTo(d.key, selectedId);
                  setSelectedId(null);
                }
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="btn"
        disabled={assignedCount !== required}
        onClick={() =>
          sendAction({
            type: 'RESOLVE_REGROWTH',
            playerId: myPlayerId,
            ...assigned,
          })
        }
      >
        Confirm {assignedCount} / {required}
      </button>
    </div>
  );
}
