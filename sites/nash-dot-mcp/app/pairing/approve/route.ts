import { getChatGPTUser } from '../../chatgpt-auth';
import { handleRemoteEndpoint, localRemotePreview } from '../../../lib/remote-http';
import { consumeRemoteRequest, remoteWorkflow } from '../../../lib/remote-runtime';
import { hostedPrivateSite } from '../../../lib/site-deployment';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  return handleRemoteEndpoint(request, { localPreview: localRemotePreview(request), hostedPrivateSite: hostedPrivateSite(request), ownerId: user?.userId ?? null,
    consumeRequest: () => consumeRemoteRequest(user?.userId ?? null),
    endpoint: (name, body, context, itemId) => remoteWorkflow().endpoint(name, body, context, itemId) });
}
