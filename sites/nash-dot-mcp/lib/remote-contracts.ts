import bundle from '../generated/remote-artifacts.json' with { type: 'json' };
import * as validators from '../generated/remote-validators.mjs';

export type RemoteError = { code: string; message: string; retryable: string };
export type RemoteResponse = { result?: unknown; error?: RemoteError };
export type RemoteBinding = { ownerId: string; deviceId: string; dotIdentity: { source: string; subject: string };
  generation: number; createdAt?: string; revokedAt?: string | null };
export const manifest = bundle.manifest;
export const vectors = bundle.vectors;
export const endpointTable = bundle.endpointTable;
export const pins = bundle.pins;

function validate(prefix: string, index: number, value: unknown): boolean {
  if (index < 0) return false;
  const fn = Reflect.get(validators, `${prefix}_${index}`);
  return typeof fn === 'function' && fn(value) === true;
}
export function validateTool(name: string, value: unknown): boolean { return validate('tool_input', manifest.tools.findIndex((tool) => tool.name === name), value); }
export function validateToolOutput(name: string, value: unknown): boolean { return validate('tool_output', manifest.tools.findIndex((tool) => tool.name === name), value); }
export function validateEndpoint(name: string, value: unknown): boolean { return validate('endpoint_input', endpointTable.endpoints.findIndex((endpoint) => endpoint.name === name), value); }
export function validateEndpointOutput(name: string, value: unknown): boolean { return validate('endpoint_output', endpointTable.endpoints.findIndex((endpoint) => endpoint.name === name), value); }
export function validateToolError(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || Array.isArray(error) || Object.keys(error).length !== 3) return false;
  return manifest.errors.some((entry) => Reflect.get(error, 'code') === entry.code
    && Reflect.get(error, 'message') === entry.message && Reflect.get(error, 'retryable') === entry.retryable);
}
export function validateEndpointError(error: unknown): boolean { return validators.endpoint_error({ error }) === true; }

const errors = new Map<string, RemoteError>(manifest.errors.map((entry) => [entry.code, entry]));
function collect(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(collect); return; }
  const node = value as Record<string, unknown>;
  const properties = node.properties as Record<string, { const?: unknown }> | undefined;
  if (properties && typeof properties.code?.const === 'string' && typeof properties.message?.const === 'string') {
    errors.set(properties.code.const, { code: properties.code.const, message: properties.message.const,
      retryable: typeof properties.retryable?.const === 'string' ? properties.retryable.const : 'no' });
  }
  Object.values(node).forEach(collect);
}
Object.values(bundle.schemas).forEach(collect);
export function remoteError(code: string): RemoteError {
  const error = errors.get(code);
  if (!error) throw new Error('Unknown generated remote error code');
  return { ...error };
}

export function publicTools() {
  return manifest.tools.map(({ nash: _serverOnly, ...tool }) => tool);
}
