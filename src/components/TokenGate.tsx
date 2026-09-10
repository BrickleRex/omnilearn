// Shown when the server has OMNILEARN_TOKEN set and we don't hold it yet
// (i.e. the app is exposed beyond localhost). One field, one cookie, done.
import { useState } from 'react';
import { api } from '../api';

export default function TokenGate() {
  const [token, setToken] = useState('');
  const [state, setState] = useState<'idle' | 'checking' | 'wrong'>('idle');

  async function submit() {
    if (!token.trim() || state === 'checking') return;
    setState('checking');
    try {
      await api.login(token.trim());
      location.reload();
    } catch {
      setState('wrong');
    }
  }

  return (
    <div className="gate">
      <div className="card gate-card" data-testid="token-gate">
        <h1>Who goes there?</h1>
        <p>
          This Omnilearn is reachable over the network, so it wants its access
          token — the <code>OMNILEARN_TOKEN</code> you started the server with.
        </p>
        <input
          className="input"
          type="password"
          placeholder="access token"
          autoFocus
          value={token}
          data-testid="token-input"
          onChange={(e) => { setToken(e.target.value); if (state === 'wrong') setState('idle'); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
        {state === 'wrong' && (
          <p className="gate-bad">
            That token didn't match. Check the server's OMNILEARN_TOKEN and try again.
          </p>
        )}
        <button
          className="btn btn-primary"
          disabled={state === 'checking' || !token.trim()}
          data-testid="token-submit"
          onClick={() => void submit()}
        >
          {state === 'checking' ? 'Checking…' : 'Let me in'}
        </button>
      </div>
    </div>
  );
}
