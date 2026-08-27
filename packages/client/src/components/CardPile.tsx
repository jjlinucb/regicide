import { useState } from 'react';
import type { Card } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/** Deterministic per-card tilt for a fanned pile — a small, stable spread rather than a fresh random jitter on every render (see hiewandboardgames.blogspot.com's session photos: a played card sitting slightly off-square is how the physical mat actually looks, not a jitter effect). */
const FAN_ROTATIONS = [-7, 4, -3, 6, -5];
function fanRotation(id: string, indexFromTop: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const base = FAN_ROTATIONS[Math.abs(hash) % FAN_ROTATIONS.length];
  return indexFromTop === 0 ? base * 0.4 : base; // the top card sits closer to square, backing cards splay more
}

/**
 * A single physical pile on the table: a fanned stack of its top few cards for piles that are face-up in real
 * life (discard, banish, a used-card pile), click-to-expand into the full contents; or a stack of card backs for
 * piles that genuinely hide their contents (the reserve/tavern deck, the castle/enemy queue).
 */
export function CardPile({
  label,
  cards,
  count,
  emptyLabel,
}: {
  label: string;
  /** Omit for a face-down pile (reserve deck, castle deck) — nothing to reveal, just a stack + count. */
  cards?: Card[];
  /** Only used when `cards` is omitted. */
  count?: number;
  emptyLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = cards !== undefined;
  const total = visible ? cards!.length : (count ?? 0);
  const fanned = visible ? [...cards!].reverse().slice(0, 3) : []; // top card first
  const interactive = visible && total > 0;
  const toggle = () => setExpanded((e) => !e);

  return (
    <div className={`card-pile${total === 0 ? ' empty' : ''}`}>
      {/* A div, not a <button> — the fanned cards inside are PlayingCard buttons of their own, and a button
          can't nest another button (invalid HTML; React warns on it). Click/Enter/Space still toggle. */}
      <div
        role="button"
        tabIndex={interactive ? 0 : -1}
        aria-disabled={!interactive}
        className="card-pile-face"
        onClick={interactive ? toggle : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle();
                }
              }
            : undefined
        }
        title={interactive ? (expanded ? 'Hide pile contents' : 'Show pile contents') : undefined}
      >
        {total === 0 ? (
          <span className="card-pile-empty-slot">{emptyLabel ?? 'empty'}</span>
        ) : visible ? (
          <span className="card-pile-fan" style={{ ['--fan-count' as string]: fanned.length }}>
            {fanned
              .slice()
              .reverse()
              .map((c, i) => {
                const indexFromTop = fanned.length - 1 - i;
                return (
                  <span
                    key={c.id}
                    className="card-pile-fan-card"
                    style={{ ['--fan-rotate' as string]: `${fanRotation(c.id, indexFromTop)}deg`, ['--fan-depth' as string]: indexFromTop }}
                  >
                    <PlayingCard card={c} />
                  </span>
                );
              })}
          </span>
        ) : (
          <span className="card-back-stack" aria-hidden="true">
            <span className="card-back" />
            <span className="card-back" />
            <span className="card-back" />
          </span>
        )}
        <span className="card-pile-count">{total}</span>
      </div>
      <span className="card-pile-label">
        {label}
        {visible && total > 0 && <span className="card-pile-toggle">{expanded ? ' ▲' : ' ▼'}</span>}
      </span>
      {visible && expanded && (
        <div className="card-pile-contents">
          {[...cards!].reverse().map((c, i) => (
            <div key={c.id} className="card-pile-card">
              <PlayingCard card={c} small />
              {i === 0 && <span className="card-pile-top-label">top</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
