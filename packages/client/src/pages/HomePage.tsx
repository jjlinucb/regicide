import { useState } from 'react';

type AsyncResult = Promise<{ ok: true } | { ok: false; error: string }>;

export function HomePage({
  onCreate,
  onJoin,
  onCreateLegacy,
  onResumeLegacy,
  onShowRules,
}: {
  onCreate: (name: string) => AsyncResult;
  onJoin: (code: string, name: string) => AsyncResult;
  onCreateLegacy: (name: string) => AsyncResult;
  onResumeLegacy: (code: string, name: string) => AsyncResult;
  onShowRules: () => void;
}) {
  const [mode, setMode] = useState<'regicide' | 'legacy'>('regicide');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isLegacy = mode === 'legacy';

  async function handleCreate() {
    if (!name.trim()) return setLocalError('Enter your name first.');
    setBusy(true);
    const res = isLegacy ? await onCreateLegacy(name.trim()) : await onCreate(name.trim());
    setBusy(false);
    if (!res.ok) setLocalError(res.error);
  }

  async function handleJoin() {
    if (!name.trim()) return setLocalError('Enter your name first.');
    if (!code.trim()) return setLocalError(isLegacy ? 'Enter your campaign code.' : 'Enter a room code.');
    setBusy(true);
    const res = isLegacy ? await onResumeLegacy(code.trim(), name.trim()) : await onJoin(code.trim(), name.trim());
    setBusy(false);
    if (!res.ok) setLocalError(res.error);
  }

  return (
    <div className="centered-page">
      <h1>Regicide</h1>
      <div className="legacy-mode-toggle">
        <button type="button" className={!isLegacy ? 'btn' : 'btn btn-secondary'} onClick={() => setMode('regicide')}>
          Regicide
        </button>
        <button type="button" className={isLegacy ? 'btn' : 'btn btn-secondary'} onClick={() => setMode('legacy')}>
          Regicide Legacy
        </button>
      </div>
      <div className="panel">
        <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
        {localError && <div className="error-banner">{localError}</div>}
        <button className="btn" disabled={busy} onClick={handleCreate}>
          {isLegacy ? 'Start a new campaign' : 'Start a new game'}
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder={isLegacy ? 'Campaign code' : 'Room code'}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={isLegacy ? 6 : 4}
            style={{ flex: 1 }}
          />
          <button className="btn btn-secondary" disabled={busy} onClick={handleJoin}>
            {isLegacy ? 'Resume' : 'Join'}
          </button>
        </div>
        {isLegacy && (
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', margin: 0 }}>
            Your campaign code is permanent — save it to resume your party's progress anytime.
          </p>
        )}
        <button type="button" className="rules-link" onClick={onShowRules}>
          How to play (Regicide &amp; Regicide Legacy)
        </button>
      </div>
    </div>
  );
}
