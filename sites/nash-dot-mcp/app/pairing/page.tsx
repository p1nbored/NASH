import { RemoteApproval, RevokePairing } from '../../components/remote-approval';
import { requireChatGPTUser } from '../chatgpt-auth';
import { remoteWorkflow } from '../../lib/remote-runtime';
export const dynamic = 'force-dynamic';
export default async function PairingPage() {
  const user = await requireChatGPTUser('/pairing');
  const localPreview = process.env.NODE_ENV === 'development';
  let generation: number | null = null;
  try {
    const connection = await remoteWorkflow().ownerConnection(user.userId);
    if (connection.status?.paired && connection.binding?.revokedAt === null) generation = connection.binding.generation;
  } catch { /* Approval remains available even when the existing pairing cannot be read. */ }
  return <main className="mx-auto max-w-2xl px-6 py-12 space-y-6">
    <a href="/" className="text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">{localPreview ? 'NASH local test' : 'NASH connection'}</a>
    <h1 className="text-3xl font-semibold">{localPreview ? 'Review a local pairing' : 'Approve your computer'}</h1>
    <p className="text-muted-foreground">Signed in as {user.displayName}.</p>
    <p className="text-sm text-muted-foreground">{localPreview ? 'This approves a fake client in the local preview only.'
      : 'Check that this code matches the pairing you started on your own computer.'}</p>
    <RemoteApproval localPreview={localPreview} />
    <p className="text-sm text-muted-foreground">Pairing codes expire after ten minutes. Approving a code records your permission; your computer must finish connecting.</p>
    {generation !== null && <RevokePairing generation={generation} />}
  </main>;
}
