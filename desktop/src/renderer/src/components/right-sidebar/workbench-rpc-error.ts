import { ZodError } from 'zod'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-client'

export type WorkbenchError = { code: string; message: string }

/** A response that parsed but contradicts what was asked for (scope, id or receipt). */
export class WorkbenchResponseError extends Error {}

/** Typed RPC failures keep their server code and English message; anything else gets a local code. */
export function toWorkbenchError(
  error: unknown,
  copy: { invalidResponse: string; failed: string }
): WorkbenchError {
  if (error instanceof RuntimeRpcCallError) {
    return { code: error.code, message: error.message }
  }
  if (error instanceof WorkbenchResponseError) {
    return { code: 'invalid_response', message: error.message }
  }
  if (error instanceof ZodError) {
    return { code: 'invalid_response', message: copy.invalidResponse }
  }
  return { code: 'request_failed', message: error instanceof Error ? error.message : copy.failed }
}
