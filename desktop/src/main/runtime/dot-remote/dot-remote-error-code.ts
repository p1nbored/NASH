import { ZodError } from 'zod'
import { OrchestrationError } from '../orchestration/orchestration-error'

// A thrown value as the sync agent logs it: a code, never the message, which may name a path or
// carry request text.

const CODE_SHAPE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

/** The refusals a store raises for the data it was handed; anything else is a failure of the store. */
const DATA_REFUSAL_CODES: ReadonlySet<string> = new Set(['dot_remote_request_not_tracked'])

export function dotRemoteErrorCode(error: unknown): string {
  if (error instanceof ZodError) {
    return 'invalid_data'
  }
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return typeof code === 'string' && CODE_SHAPE.test(code) ? code : 'unexpected'
}

/** True when the data itself was refused, so trying it again would be refused again. */
export function isDotRemoteDataRefusal(error: unknown): boolean {
  return (
    error instanceof ZodError ||
    (error instanceof OrchestrationError && DATA_REFUSAL_CODES.has(error.code))
  )
}
