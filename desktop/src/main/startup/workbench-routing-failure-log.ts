import { redactString } from '../observability/redactor'

const LOG_PREFIX = '[workbench-routing] router failure'
const MAX_MESSAGE_CHARS = 300
const MAX_CAUSES = 3
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/

type FailureLogSink = (message: string, details: Record<string, unknown>) => void

const consoleSink: FailureLogSink = (message, details) => {
  console.warn(message, details)
}

/** Redact first, then cut, so a secret split by the length limit cannot slip past the patterns. */
function safeMessage(error: Error): string {
  return redactString(error.message).slice(0, MAX_MESSAGE_CHARS)
}

function safeName(error: Error): string {
  return SAFE_ERROR_NAME.test(error.name) ? error.name : 'Error'
}

function safeCode(error: Error): string | null {
  const code: unknown = Reflect.get(error, 'code')
  return typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : null
}

function causeMessages(error: Error): string[] {
  const messages: string[] = []
  let cause: unknown = error.cause
  while (cause instanceof Error && messages.length < MAX_CAUSES) {
    messages.push(safeMessage(cause))
    cause = cause.cause
  }
  return messages
}

function describeFailure(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    // Why not read it: a thrown plain object can hold anything, so only its type is reported.
    return { name: 'NonError', code: null, message: '', causes: [] }
  }
  return {
    name: safeName(error),
    code: safeCode(error),
    message: safeMessage(error),
    causes: causeMessages(error)
  }
}

/**
 * The `onFailure` sink of the routing runtime. It receives raw errors, so it logs only the class,
 * a system code, and messages passed through the diagnostic redactor; never a stack or a field
 * of a non-Error value. Logging can never throw into the failure path it serves.
 */
export function createRoutingFailureLogger(
  sink: FailureLogSink = consoleSink
): (error: unknown) => void {
  return (error) => {
    try {
      sink(LOG_PREFIX, describeFailure(error))
    } catch {
      // Why swallowed: a failing log sink must not turn a handled routing failure into a crash.
    }
  }
}
