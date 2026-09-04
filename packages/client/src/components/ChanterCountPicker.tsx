import { useState } from 'react';

/**
 * A numeric input, not a row of buttons like ReaverRevealCountPicker — `maxCount` here is the reserve deck's own
 * current size (see GameState.chanterCountChoice), which can run into the dozens, so a button per count would be
 * unusable. Lets the player declare how many cards a Chanter's chant draws for everyone, independent of the
 * Chanter card's own printed rank (John's house rule, 2026-09-04).
 */
export function ChanterCountPicker({ maxCount, onChoose }: { maxCount: number; onChoose: (count: number) => void }) {
  const [value, setValue] = useState(1);
  const clamped = Math.min(Math.max(1, Math.round(value) || 1), maxCount);

  return (
    <div className="jester-picker-choices">
      <input
        type="number"
        min={1}
        max={maxCount}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        className="chanter-count-input"
      />
      <button type="button" className="btn" onClick={() => onChoose(clamped)}>
        Draw {clamped}
      </button>
    </div>
  );
}
