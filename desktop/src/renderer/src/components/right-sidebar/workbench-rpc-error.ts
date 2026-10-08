import { ZodError } from 'zod'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-client'
import {
  genericErrorMessage,
  unexpectedResponseMessage,
  workbenchErrorMessage
} from './workbench-error-copy'

/**
 * `message` is the one sentence the UI shows. `code`, `reason` (a refusal's sub-code) and `detail`
 * (the server's or runtime's own text) reach only "Copy details".
 */
export type WorkbenchError = {
  code: string
  message: string
  reason?: string
  detail?: string
}

/** A response that parsed but contradicts what was asked for (scope, id or receipt). */
export class WorkbenchResponseError extends Error {}

/** A known code gets its own sentence; anything else gets `fallback`, or a generic sentence. */
export function toWorkbenchError(error: unknown, fallback?: string): WorkbenchError {
  const otherwise = fallback ?? genericErrorMessage()
  if (error instanceof RuntimeRpcCallError) {
    return {
      code: error.code,
      message: workbenchErrorMessage(error.code) ?? otherwise,
      detail: error.message
    }
  }
  if (error instanceof WorkbenchResponseError) {
    return { code: 'invalid_response', message: unexpectedResponseMessage(), detail: error.message }
  }
  if (error instanceof ZodError) {
    return { code: 'invalid_response', message: unexpectedResponseMessage() }
  }
  return error instanceof Error
    ? { code: 'request_failed', message: otherwise, detail: error.message }
    : { code: 'request_failed', message: otherwise }
}
