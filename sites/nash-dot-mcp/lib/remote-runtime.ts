import { env } from 'cloudflare:workers';
import { createRemoteWorkflow } from './remote-workflow';
import { createScaffoldStorage } from './scaffold-storage';

export function remoteWorkflow() {
  if (!env.DB) throw new Error('Remote D1 unavailable');
  return createRemoteWorkflow(env.DB);
}
export async function consumeRemoteRequest(ownerId: string | null) {
  if (!env.DB) throw new Error('Remote D1 unavailable');
  return createScaffoldStorage(env.DB).consumeMcpCall({ userId: ownerId ? `approval:${ownerId}` : 'remote-endpoints' });
}
