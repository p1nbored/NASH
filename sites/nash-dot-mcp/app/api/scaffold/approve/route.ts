import { getChatGPTUser } from '../../../chatgpt-auth';
import { handlePairingScaffold } from '../../../../lib/pairing-scaffold';
import { scaffoldStorage } from '../../../../lib/scaffold-runtime';
import { localRemotePreview } from '../../../../lib/remote-http';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  if (!localRemotePreview(request)) return new Response(null, { status: 404 });
  const user = await getChatGPTUser();
  return handlePairingScaffold(request, { ownerUserId: user?.userId ?? null, storage: scaffoldStorage }, 'approve');
}
