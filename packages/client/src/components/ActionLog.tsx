import type { ClientGameState } from '@regicide/shared';

export function ActionLog({ state }: { state: ClientGameState }) {
  // Rendered oldest-last into a column-reverse container, so the newest entry
  // sits at the visible bottom edge without needing to scroll.
  const recent = state.log.slice(-30).reverse();
  return (
    <div className="log-panel">
      {recent.map((entry, i) => (
        <div key={i}>{entry.message}</div>
      ))}
    </div>
  );
}
