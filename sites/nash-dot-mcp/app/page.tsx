import { PairingDemo } from '../components/pairing-demo';
import { RevokePairing } from '../components/remote-approval';
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from './chatgpt-auth';
import { remoteWorkflow } from '../lib/remote-runtime';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser();
  const localPreview = process.env.NODE_ENV === 'development';
  let status: { paired: boolean; online: boolean; lastSeenAt: string | null } | null = localPreview
    ? { paired: false, online: false, lastSeenAt: null } : null;
  let generation: number | null = null;
  if (user && !localPreview) {
    try {
      const connection = await remoteWorkflow().ownerConnection(user.userId);
      status = connection.status ?? { paired: false, online: false, lastSeenAt: null };
      if (status?.paired && connection.binding?.revokedAt === null) generation = connection.binding.generation;
    } catch { /* The page stays usable when connection status cannot be read. */ }
  }
  const connection = status ? status.online ? 'Online' : status.paired ? 'Paired · offline' : 'Disconnected'
    : user ? 'Status unavailable' : 'Sign in to view';
  return <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 space-y-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">{localPreview ? 'NASH / Local test' : 'NASH / Remote connection'}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{localPreview ? 'Connection foundations' : 'Connect your computer'}</h1>
        <p className="text-muted-foreground">{localPreview ? 'Verify the connection flow before connecting your computer.'
          : 'Review and approve the pairing started on your computer.'}</p>
      </div>
      <span className="rounded-full border px-3 py-1 text-sm">{connection}</span>
    </header>
    <section className="rounded-xl border p-6 space-y-3" aria-labelledby="status-title">
      <h2 id="status-title" className="text-xl font-semibold">Current state</h2>
      <dl className="grid gap-4 sm:grid-cols-3 text-sm">
        <div><dt className="text-muted-foreground">Computer</dt><dd className="font-medium">{status ? status.online ? 'Online'
          : status.paired ? 'Waiting for App' : 'No App paired' : user ? 'Status unavailable' : 'Sign in to check'}</dd></div>
        <div><dt className="text-muted-foreground">{localPreview ? 'Remote access' : 'Pairing'}</dt><dd className="font-medium">{localPreview ? 'Off'
          : status ? status.paired ? 'Paired' : 'Not paired' : 'Unknown'}</dd></div>
        <div><dt className="text-muted-foreground">{localPreview ? 'Task delivery' : 'Last contact'}</dt><dd className="font-medium">{localPreview ? 'Unavailable'
          : status?.lastSeenAt ? <time dateTime={status.lastSeenAt}>{new Date(status.lastSeenAt).toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</time>
            : status ? 'Not yet' : 'Unknown'}</dd></div>
      </dl>
      {user && !status && <p className="text-sm text-muted-foreground">Connection status could not be loaded. Refresh this page to try again.</p>}
    </section>
    {user ? <>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p>Signed in as {user.displayName}</p>
        <a className="underline underline-offset-4" href={chatGPTSignOutPath('/')} target="_top">Sign out</a>
      </div>
      {localPreview && <PairingDemo />}
      <section className="rounded-xl border p-6 space-y-3" aria-labelledby="connect-title">
        <h2 id="connect-title" className="text-xl font-semibold">{localPreview ? 'Review a local client' : 'Approve a computer'}</h2>
        <p className="text-sm text-muted-foreground">{localPreview ? 'Use the pairing code from the local fake client.'
          : 'Enter the pairing code from your computer. Only approve a pairing you started.'}</p>
        <a href="/pairing" className="inline-block rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4">Review pairing code</a>
      </section>
      {generation !== null && <RevokePairing generation={generation} />}
    </> : <section className="rounded-xl border p-6 space-y-4">
      <h2 className="text-xl font-semibold">{localPreview ? 'Sign in to test approval' : 'Sign in to approve your computer'}</h2>
      <p className="text-sm text-muted-foreground">{localPreview ? 'The local preview uses a demo account. No real Site or App is connected.'
        : 'Use your ChatGPT account to review pairing requests and view your connection.'}</p>
      <a className="inline-block rounded-lg bg-primary px-4 py-2 text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4" href={chatGPTSignInPath('/')} target="_top">{localPreview ? 'Sign in for local test' : 'Sign in with ChatGPT'}</a>
    </section>}
    <footer className="border-t pt-6 text-sm text-muted-foreground">
      {localPreview ? 'Demo approvals are single-use and expire after five minutes. They issue no App access credentials.'
        : 'Pairing codes expire after ten minutes and can be used once. Your computer connects after it completes pairing.'}
    </footer>
  </main>;
}
