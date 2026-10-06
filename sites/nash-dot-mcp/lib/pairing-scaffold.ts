export type PairingScaffoldDependencies = {
  ownerUserId: string | null;
  storage: () => {
    consumeMcpCall(owner: { userId: string }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
    purgeExpired(): Promise<unknown>;
    beginChallenge(owner: { userId: string }, deviceRef: string): Promise<unknown>;
    approveChallenge(owner: { userId: string }, challengeId: string): Promise<unknown | null>;
  };
};

function response(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
}

export async function handlePairingScaffold(request: Request, deps: PairingScaffoldDependencies, action: 'begin' | 'approve'): Promise<Response> {
  if (!deps.ownerUserId) return response({ code: 'sign_in_required' }, 401);
  if (request.headers.get('origin') !== new URL(request.url).origin) return response({ code: 'origin_refused' }, 403);
  if (request.method !== 'POST') return response({ code: 'method_refused' }, 405, { allow: 'POST' });
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return response({ code: 'payload_invalid' }, 415);
  let value: unknown;
  try {
    const body = await boundedJsonBody(request, 2048);
    if (body === null) return response({ code: 'payload_too_large' }, 413);
    value = JSON.parse(body);
  } catch { return response({ code: 'payload_invalid' }, 400); }
  const key = action === 'begin' ? 'deviceRef' : 'challengeId';
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !Object.hasOwn(value, key)) return response({ code: 'payload_invalid' }, 400);
  const field = Reflect.get(value, key);
  const pattern = action === 'begin' ? /^dev_[A-Za-z0-9_-]{1,64}$/ : /^dch_[a-f0-9]{64}$/;
  if (typeof field !== 'string' || !pattern.test(field)) return response({ code: 'payload_invalid' }, 400);
  const owner = { userId: deps.ownerUserId };
  try {
    const storage = deps.storage();
    const allowance = await storage.consumeMcpCall(owner);
    if (!allowance.allowed) return response({ code: 'rate_limited' }, 429, { 'retry-after': String(allowance.retryAfterSeconds) });
    await storage.purgeExpired();
    if (action === 'begin') return response({ scaffold: true, paired: false, challenge: await storage.beginChallenge(owner, field) });
    const approved = await storage.approveChallenge(owner, field);
    return approved === null ? response({ code: 'challenge_unavailable' }, 404)
      : response({ scaffold: true, paired: false, approved: true });
  } catch { return response({ code: 'storage_unavailable' }, 503); }
}
import { boundedJsonBody } from './bounded-json-body.ts';
