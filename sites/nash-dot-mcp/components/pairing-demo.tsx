'use client';

import { useState } from 'react';

type Challenge = { challengeId: string; deviceRef: string; expiresAt: number };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validChallenge(value: unknown): value is Challenge {
  return record(value) && typeof value.challengeId === 'string' && /^dch_[a-f0-9]{64}$/.test(value.challengeId)
    && typeof value.deviceRef === 'string' && /^dev_[A-Za-z0-9_-]{1,64}$/.test(value.deviceRef)
    && typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt);
}

export function PairingDemo() {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('No demo device approved.');

  async function act(approve: boolean) {
    setPending(true);
    try {
      const response = await fetch(`/api/scaffold/${approve ? 'approve' : 'challenges'}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(approve ? { challengeId: challenge?.challengeId } : { deviceRef: 'dev_fixture_one' }),
      });
      const value = await response.json();
      if (!record(value)) throw new Error('Invalid demo response');
      if (!response.ok) {
        setMessage(value.code === 'challenge_unavailable' ? 'Challenge expired or already used. Create another demo challenge.'
          : value.code === 'rate_limited' ? 'Too many actions. Try again in a minute.' : 'The demo could not be completed.');
        if (value.code === 'challenge_unavailable') setChallenge(null);
        return;
      }
      if (approve) {
        setChallenge(null);
        setMessage('Demo approval recorded. NASH remains disconnected.');
      } else {
        if (!validChallenge(value.challenge)) throw new Error('Invalid demo challenge');
        setChallenge(value.challenge);
        setMessage('Review this demo device before approving.');
      }
    } catch { setMessage('The local preview could not be reached.'); }
    finally { setPending(false); }
  }

  return <section className="rounded-xl border p-6 space-y-4" aria-labelledby="pairing-title">
    <h2 id="pairing-title" className="text-xl font-semibold">Pairing simulation</h2>
    <p className="text-sm text-muted-foreground">This approves a local test device. It creates no App connection or access credential.</p>
    <p role="status" aria-live="polite">{message}</p>
    {challenge && <dl className="text-sm space-y-2">
      <div><dt className="font-medium">Device</dt><dd>{challenge.deviceRef}</dd></div>
      <div><dt className="font-medium">Expires</dt><dd>{new Date(challenge.expiresAt).toLocaleTimeString()}</dd></div>
    </dl>}
    <button type="button" disabled={pending} onClick={() => act(Boolean(challenge))}
      className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4">
      {pending ? 'Working…' : challenge ? 'Approve demo device' : 'Create demo challenge'}
    </button>
  </section>;
}
