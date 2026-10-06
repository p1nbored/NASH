import assert from 'node:assert/strict';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value), 'Expected a JSON object');
  return value;
}
