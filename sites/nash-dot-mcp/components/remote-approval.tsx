'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function RemoteApproval({ localPreview = false }: { localPreview?: boolean }) {
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [message, setMessage] = useState(localPreview ? 'Enter the code shown by the local fake client.' : 'Enter the pairing code shown on your computer.');
  const codeInput = useRef<HTMLInputElement>(null);
  async function answer(decision: 'approve' | 'deny') {
    if (pending) return;
    const userCode = code.trim().toUpperCase();
    if (!/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(userCode)) {
      setInvalid(true); setMessage('Use the eight-letter code, including its hyphen.'); codeInput.current?.focus(); return;
    }
    setInvalid(false);
    setPending(true);
    setMessage(decision === 'approve' ? 'Recording approval…' : 'Recording your decision…');
    try {
      const response = await fetch('/pairing/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userCode, decision }) });
      const value: unknown = await response.json();
      if (!response.ok) {
        const error = value && typeof value === 'object' ? Reflect.get(value, 'error') : null;
        const errorCode = error && typeof error === 'object' ? Reflect.get(error, 'code') : null;
        setMessage(errorCode === 'unauthorized' ? 'Sign in again, then review the pairing code.'
          : errorCode === 'rate_limited' || response.status === 503 ? 'Approval is temporarily unavailable. Try again shortly.'
            : errorCode === 'challenge_expired' ? 'The code expired. Start pairing again on your computer.'
              : 'Code unavailable or already answered. Start pairing again on your computer.');
        return;
      }
      if (!value || typeof value !== 'object' || Reflect.get(value, 'outcome') !== (decision === 'approve' ? 'approved' : 'denied')) {
        setMessage('The service could not confirm your decision. Refresh this page before trying again.'); return;
      }
      setCode(''); setMessage(decision === 'approve'
        ? localPreview ? 'Local client approved. No real NASH App is connected.' : 'Approval recorded. Return to your computer to finish connecting.'
        : localPreview ? 'Local challenge denied.' : 'Pairing declined. This computer cannot connect using that code.');
    } catch { setMessage(localPreview ? 'Local preview unavailable.' : 'The connection service could not be reached. Try again shortly.'); }
    finally { setPending(false); }
  }
  return <form noValidate onSubmit={(event) => { event.preventDefault(); void answer('approve'); }}
    className="rounded-xl border p-6 space-y-4" aria-busy={pending}>
    <label htmlFor="pairing-code" className="block font-medium">{localPreview ? 'Local pairing code' : 'Pairing code'}</label>
    <input ref={codeInput} id="pairing-code" value={code} onChange={(event) => { setCode(event.target.value); setInvalid(false); }}
      placeholder="BCDF-GHJK" autoComplete="off" autoCapitalize="characters" spellCheck={false} required disabled={pending}
      maxLength={9} className="w-full rounded-lg border px-3 py-2 uppercase focus-visible:outline-2 focus-visible:outline-offset-4 sm:max-w-xs"
      aria-invalid={invalid} aria-describedby="code-help approval-status" />
    <p id="code-help" className="text-sm text-muted-foreground">Only approve a pairing you started on your own computer.</p>
    <p id="approval-status" role={invalid ? 'alert' : 'status'} aria-live={invalid ? 'assertive' : 'polite'} aria-atomic="true">{message}</p>
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4">{pending ? 'Working…' : localPreview ? 'Approve local client' : 'Approve computer'}</button>
      <button type="button" disabled={pending} onClick={() => { void answer('deny'); }} className="rounded-lg border px-4 py-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4">Deny</button>
    </div>
  </form>;
}

export function RevokePairing({ generation }: { generation: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [message, setMessage] = useState('');
  async function revoke() {
    if (pending || revoked) return;
    setPending(true);
    setMessage('Revoking pairing…');
    try {
      const response = await fetch('/pairing/revoke', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ generation }) });
      const value: unknown = await response.json();
      if (!response.ok) {
        const error = value && typeof value === 'object' ? Reflect.get(value, 'error') : null;
        const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : null;
        setMessage(code === 'generation_revoked' ? 'The pairing has changed. Refresh this page to see the current connection.'
          : code === 'unauthorized' ? 'Sign in again before revoking this pairing.' : 'Pairing could not be revoked. Try again shortly.');
        return;
      }
      if (!value || typeof value !== 'object' || Reflect.get(value, 'revokedGeneration') !== generation) {
        setMessage('The service could not confirm revocation. Refresh this page to check the connection.'); return;
      }
      setRevoked(true);
      setMessage('Pairing revoked. Pair your computer again to reconnect.');
      router.refresh();
    } catch { setMessage('The connection service could not be reached. Try again shortly.'); }
    finally { setPending(false); }
  }
  return <form onSubmit={(event) => { event.preventDefault(); void revoke(); }}
    className="rounded-xl border p-6 space-y-4" aria-labelledby="revoke-title" aria-busy={pending}>
    <h2 id="revoke-title" className="text-xl font-semibold">Revoke pairing</h2>
    <p id="revoke-help" className="text-sm text-muted-foreground">Stop future remote work and disconnect this computer. Runs already accepted continue on your computer.</p>
    <p role="status" aria-live="polite" aria-atomic="true">{message}</p>
    <button type="submit" disabled={pending || revoked} aria-describedby="revoke-help"
      className="rounded-lg border px-4 py-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4">
      {pending ? 'Revoking…' : revoked ? 'Pairing revoked' : 'Revoke pairing'}
    </button>
  </form>;
}
