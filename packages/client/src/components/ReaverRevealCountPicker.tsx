/**
 * A row of buttons, one per count from 1 to maxCount — lets the player pick how many cards a Reaver's reveal
 * should pull off the reserve deck (see GameState.reaverRevealCountChoice). Every card revealed is banished
 * whether chosen or not, so a smaller count is strictly safer at the cost of fewer candidates to pick from.
 */
export function ReaverRevealCountPicker({ maxCount, onChoose }: { maxCount: number; onChoose: (count: number) => void }) {
  return (
    <div className="jester-picker-choices">
      {Array.from({ length: maxCount }, (_, i) => i + 1).map((count) => (
        <button key={count} type="button" className="btn" onClick={() => onChoose(count)}>
          Reveal {count}
        </button>
      ))}
    </div>
  );
}
