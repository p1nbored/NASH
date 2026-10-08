import contract from '../generated/dot-hello-schema.json' with { type: 'json' };
import { boundedJsonBody } from './bounded-json-body.ts';
import { manifest, type RemoteResponse } from './remote-contracts.ts';

export type McpScaffoldDependencies = {
  ownerUserId: string | null;
  consumeCall: () => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  toolCatalog?: unknown[];
  invokeTool?: (name: string, argumentsValue: unknown) => Promise<RemoteResponse>;
};

const PROTOCOLS = ['2025-06-18', '2025-03-26'];
const BODY_LIMIT = 65_536;
// What dot reads on connect when the generated mailbox tools are wired; it must match what they do.
const MAILBOX_SERVER = { name: 'nash', version: `contract-${manifest.contractVersion}` };
const MAILBOX_INSTRUCTIONS = "NASH runs tasks on the user's own PC. This server is NASH's mailbox: a "
  + `task you submit waits here until NASH takes it, and expires if NASH does not take it within ${manifest.policy.defaults.submitTtlMinutes} minutes. `
  + 'Every status and result is what NASH last reported. Call nash_status first; NASH must be paired and online. '
  + 'nash_list_workspaces shows maxAccess for each workspace: ask for workspace_write only when the task must change '
  + 'files and maxAccess allows it, otherwise read_only.';
type RpcId = string | number | null;
type JsonSchema = {
  type?: string;
  const?: unknown;
  pattern?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The scaffold uses only the extracted hello schema; mailbox schemas belong to R2.
function matches(schema: JsonSchema, value: unknown): boolean {
  if ('const' in schema && value !== schema.const) return false;
  if (schema.type === 'object') {
    if (!record(value)) return false;
    const properties = schema.properties ?? {};
    if (schema.required?.some((key) => !(key in value))) return false;
    return Object.entries(value).every(([key, item]) =>
      Object.hasOwn(properties, key) ? matches(properties[key], item) : schema.additionalProperties !== false,
    );
  }
  if (schema.type === 'string') {
    return typeof value === 'string' && (!schema.pattern || new RegExp(schema.pattern, 'u').test(value));
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    return typeof value === 'number' && Number.isFinite(value)
      && (schema.type !== 'integer' || Number.isInteger(value));
  }
  return true;
}

function json(value: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(value, { status, headers: {
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extraHeaders,
  } });
}

function error(id: RpcId, code: number, message: string, status = 200, extraHeaders = {}) {
  return json({ jsonrpc: '2.0', id, error: { code, message } }, status, extraHeaders);
}

function result(id: RpcId, value: unknown) {
  return json({ jsonrpc: '2.0', id, result: value });
}

export async function handleScaffoldMcp(request: Request, dependencies: McpScaffoldDependencies): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return error(null, -32000, 'Origin refused.', 403);
  if (request.method !== 'POST') return error(null, -32600, 'Use HTTP POST.', 405, { allow: 'POST' });
  const version = request.headers.get('mcp-protocol-version');
  if (version && !PROTOCOLS.includes(version)) return error(null, -32600, 'Unsupported protocol version.', 400);
  const accept = request.headers.get('accept') ?? '';
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    return error(null, -32600, 'Accept JSON and event streams.', 406);
  }
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return error(null, -32600, 'Use application/json.', 415);
  }
  let raw: unknown;
  try {
    const body = await boundedJsonBody(request, BODY_LIMIT);
    if (body === null) return error(null, -32600, 'Request body exceeds the scaffold limit.', 413);
    raw = JSON.parse(body);
  } catch { return error(null, -32700, 'Invalid JSON.', 400); }
  if (!record(raw) || raw.jsonrpc !== '2.0' || typeof raw.method !== 'string') {
    return error(null, -32600, 'Invalid RPC request.', 400);
  }
  if ('id' in raw && typeof raw.id !== 'string' && !(typeof raw.id === 'number' && Number.isSafeInteger(raw.id))) {
    return error(null, -32600, 'Invalid request ID.', 400);
  }
  if (!('id' in raw)) {
    return raw.method.startsWith('notifications/')
      ? new Response(null, { status: 202, headers: { 'cache-control': 'no-store' } })
      : error(null, -32600, 'Request ID is required.', 400);
  }
  const id = typeof raw.id === 'string' || typeof raw.id === 'number' ? raw.id : null;
  const params = raw.params ?? {};
  if (!record(params)) return error(id, -32602, 'Invalid params.');
  if (raw.method === 'initialize') {
    if (typeof params.protocolVersion !== 'string' || !record(params.capabilities) || !record(params.clientInfo)
      || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') {
      return error(id, -32602, 'Invalid initialization params.');
    }
    return result(id, {
      protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: dependencies.invokeTool ? MAILBOX_SERVER : { name: 'nash-local-scaffold', version: '0.1.0' },
      instructions: dependencies.invokeTool ? MAILBOX_INSTRUCTIONS
        : 'Local scaffold only. No NASH pairing, mailbox, or task execution is available.',
    });
  }
  if (raw.method === 'ping') return result(id, {});
  if (raw.method === 'tools/list') {
    return result(id, { tools: dependencies.toolCatalog ?? [{
      name: 'nash_status', description: 'Read local scaffold readiness. No NASH App is connected.',
      inputSchema: contract.schema, annotations: { readOnlyHint: true, idempotentHint: true },
    }] });
  }
  if (raw.method !== 'tools/call') return error(id, -32601, 'Method unavailable.');
  if (!dependencies.ownerUserId) return error(id, -32001, 'Sign in is required.', 401);
  if (dependencies.invokeTool) {
    if (typeof params.name !== 'string') return error(id, -32602, 'Invalid tool name.');
    try {
      const reply = await dependencies.invokeTool(params.name, params.arguments ?? {});
      const structuredContent = reply.error ? { error: reply.error } : reply.result;
      return result(id, { ...(reply.error ? { isError: true } : {}),
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent });
    } catch { return error(id, -32003, 'Scaffold storage unavailable.', 503); }
  }
  try {
    const allowance = await dependencies.consumeCall();
    if (!allowance.allowed) return error(id, -32002, 'Rate limited.', 429, {
      'retry-after': String(allowance.retryAfterSeconds),
    });
  } catch { return error(id, -32003, 'Scaffold storage unavailable.', 503); }
  if (params.name !== 'nash_status') return error(id, -32602, 'Tool unavailable until R2 is integrated.');
  if (!matches(contract.schema, params.arguments)) return error(id, -32602, 'Invalid tool arguments.');
  const status = {
    scaffold: true, online: false, paired: false, remoteAccess: false, contractVersion: 2,
    schemaSourceSha256: contract.sourceSha256,
  };
  return result(id, { content: [{ type: 'text', text: JSON.stringify(status) }], structuredContent: status });
}
