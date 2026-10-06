import type { PairingContext } from './remote-pairing.ts';
import { endpointTable, remoteError, validateEndpoint, type RemoteResponse } from './remote-contracts.ts';
import { boundedJsonBody } from './bounded-json-body.ts';
export type RemoteHttpDependencies = { localPreview: boolean; hostedPrivateSite?: boolean; ownerId: string | null;
  consumeRequest: () => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  endpoint: (name: string, body: unknown, context: PairingContext, itemId?: string) => Promise<RemoteResponse> };
export function localRemotePreview(request: Request): boolean {
  return process.env.NODE_ENV === 'development' && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(request.url).hostname);
}
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
}
function refused(code: string, status: number, headers = {}) { return json({ error: remoteError(code) }, status, headers); }

export async function handleRemoteEndpoint(request: Request, deps: RemoteHttpDependencies): Promise<Response> {
  if (!deps.localPreview && !deps.hostedPrivateSite) return refused('unauthorized', 503);
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return refused('unauthorized', 403);
  let itemId: string | undefined;
  const endpoint = endpointTable.endpoints.find((entry) => {
    const [prefix, suffix] = entry.path.split('{itemId}');
    if (suffix === undefined) return entry.path === url.pathname;
    if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(suffix)) return false;
    const candidate = url.pathname.slice(prefix.length, -suffix.length);
    if (!candidate || candidate.includes('/')) return false;
    itemId = candidate; return true;
  });
  if (!endpoint) return refused('payload_invalid', 404);
  if (endpoint.method !== request.method) return refused('payload_invalid', 405, { allow: endpoint.method });
  const ownerAction = endpoint.caller === 'owner';
  if (ownerAction && origin !== url.origin) return refused('unauthorized', 403);
  if (ownerAction && !deps.ownerId) return refused('unauthorized', 401);
  // Sites dispatch consumes its service bearer before forwarding. Never treat a
  // client-provided header as proof of hosted admission or as a visitor identity.
  if (!ownerAction && deps.localPreview && request.headers.get('OAI-Sites-Authorization') !== 'Bearer local-fixture-only') return refused('unauthorized', 401);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return refused('payload_invalid', 415);
  let body: unknown;
  try {
    const text = await boundedJsonBody(request, endpoint.name === 'events.post' ? 1_048_576 : 65_536);
    if (text === null) return refused('payload_invalid', 413);
    body = JSON.parse(text);
  } catch { return refused('payload_invalid', 400); }
  if (!validateEndpoint(endpoint.name, body)) return refused('payload_invalid', 400);
  if (itemId && (body === null || typeof body !== 'object' || Reflect.get(body, 'itemId') !== itemId)) return refused('payload_invalid', 400);
  try {
    const allowance = await deps.consumeRequest();
    if (!allowance.allowed) return refused('rate_limited', 429, { 'retry-after': String(allowance.retryAfterSeconds) });
    const reply = await deps.endpoint(endpoint.name, body, {
      ...(ownerAction && deps.ownerId ? { ownerId: deps.ownerId } : {}), platformAdmitted: !ownerAction,
      sessionToken: request.headers.get('Nash-Session') ?? undefined,
      deviceCredential: request.headers.get('Nash-Device-Credential') ?? undefined,
    }, itemId);
    if (!reply.error) return json(reply.result);
    const code = reply.error.code;
    const status = code === 'unauthorized' || code === 'device_credential_invalid' ? 401 : code === 'generation_revoked' ? 403
      : code === 'rate_limited' ? 429 : code === 'challenge_not_found' ? 404 : code === 'payload_invalid' ? 400 : 409;
    return json({ error: reply.error }, status);
  } catch { return refused('rate_limited', 503); }
}
