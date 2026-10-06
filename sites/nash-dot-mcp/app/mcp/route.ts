import { getChatGPTUser } from '../chatgpt-auth';
import { handleScaffoldMcp } from '../../lib/mcp-scaffold';
import { scaffoldStorage } from '../../lib/scaffold-runtime';
import { publicTools, remoteError } from '../../lib/remote-contracts';
import { localRemotePreview } from '../../lib/remote-http';
import { remoteWorkflow } from '../../lib/remote-runtime';
import { hostedPrivateSite } from '../../lib/site-deployment';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  return handleScaffoldMcp(request, {
    ownerUserId: user?.userId ?? null,
    toolCatalog: publicTools(),
    invokeTool: async (name, input) => {
      if ((!localRemotePreview(request) && !hostedPrivateSite(request)) || !user) return { error: remoteError('nash_never_paired') };
      return remoteWorkflow().tool(user.userId, name, input);
    },
    consumeCall: async () => {
      if (!user) throw new Error('Owner identity unavailable');
      const store = scaffoldStorage();
      const allowance = await store.consumeMcpCall({ userId: user.userId });
      await store.purgeExpired();
      return allowance;
    },
  });
}

export async function GET(request: Request) {
  return handleScaffoldMcp(request, { ownerUserId: null, consumeCall: async () => ({ allowed: false, retryAfterSeconds: 0 }) });
}
