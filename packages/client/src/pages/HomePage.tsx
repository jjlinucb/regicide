import { useState } from 'react';

export function HomePage({
  onCreate,
  onJoin,
}: {
  onCreate: (name: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onJoin: (code: string, name: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return setLocalError('Enter your name first.');
    setBusy(true);
    const res = await onCreate(name.trim());
    setBusy(false);
    if (!res.ok) setLocalError(res.error);
  }

  async function handleJoin() {
    if (!name.trim()) return setLocalError('Enter your name first.');
    if (!code.trim()) return setLocalError('Enter a room code.');
    setBusy(true);
    const res = await onJoin(code.trim(), name.trim());
    setBusy(false);
    if (!res.ok) setLocalError(res.error);
  }

  return (
    <div className="centered-page">
      <h1>Regicide</h1>
      <div className="panel">
        <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
        {localError && <div className="error-banner">{localError}</div>}
        <button className="btn" disabled={busy} onClick={handleCreate}>
          Start a new game
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="Room code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            style={{ flex: 1 }}
          />
          <button className="btn btn-secondary" disabled={busy} onClick={handleJoin}>
            Join
          </button>
        </div>
      </div>
    </div>
  );
}
