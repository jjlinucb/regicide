import { useState } from 'react';
import type { Card } from '@regicide/shared';
import { PlayingCard } from './PlayingCard';

/**
 * A single physical pile on the table: a labeled stack with a count, click-to-expand into the actual cards for
 * piles that are face-up in real life (discard, banish, a used-card pile), or a plain face-down stack for piles
 * that genuinely hide their contents (the reserve/tavern deck, the castle/enemy queue).
 */
export function CardPile({
  label,
  icon,
  cards,
  count,
  emptyLabel,
}: {
  label: string;
  icon: string;
  /** Omit for a face-down pile (reserve deck, castle deck) — nothing to reveal, just a stack + count. */
  cards?: Card[];
  /** Only used when `cards` is omitted. */
  count?: number;
  emptyLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = cards !== undefined;
  const total = visible ? cards!.length : (count ?? 0);
  const top = visible && cards!.length > 0 ? cards![cards!.length - 1] : null;

  return (
    <div className={`card-pile${total === 0 ? ' empty' : ''}`}>
      <button
        type="button"
        className="card-pile-summary"
        onClick={visible && total > 0 ? () => setExpanded((e) => !e) : undefined}
        disabled={!visible || total === 0}
        title={visible && total > 0 ? (expanded ? 'Hide pile contents' : 'Show pile contents') : undefined}
      >
        <span className="card-pile-stack" aria-hidden="true">
          {icon}
        </span>
        <span className="card-pile-label">
          {label}: {total}
        </span>
        {visible && total > 0 && <span className="card-pile-toggle">{expanded ? '▲' : '▼'}</span>}
      </button>
      {visible && total === 0 && emptyLabel && <span className="card-pile-empty-note">{emptyLabel}</span>}
      {visible && !expanded && top && (
        <div className="card-pile-top-hint">
          top: <PlayingCard card={top} small />
        </div>
      )}
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
