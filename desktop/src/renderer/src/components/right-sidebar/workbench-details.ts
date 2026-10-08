import { redactSecretShapes } from '../../../../shared/crash-report-redaction'
import type { WorkbenchError } from './workbench-rpc-error'

/** One `key: value` line of the block "Copy details" puts on the clipboard. */
export type WorkbenchDetail = readonly [key: string, value: string | number | null | undefined]

// Why snake_case keys in English: the block is diagnostic data for a report, read the same in
// every UI language (D-013), and it is the only place IDs, codes, hashes and hosts appear.
export function formatWorkbenchDetails(
  subject: string,
  entries: readonly WorkbenchDetail[]
): string {
  const lines = entries.flatMap(([key, value]) => {
    const text = value === null || value === undefined ? '' : String(value)
    return text.trim() === '' ? [] : [`${key}: ${text.replace(/\r?\n|\r/g, ' ')}`]
  })
  return redactSecretShapes([`NASH Workbench: ${subject}`, ...lines].join('\n'))
}

/** The error's code, any sub-code and the raw server or runtime text (else the shown sentence). */
export function errorDetails(
  error: WorkbenchError | null | undefined,
  prefix?: string
): WorkbenchDetail[] {
  if (!error) {
    return []
  }
  const key = (name: string): string => (prefix ? `${prefix}_error_${name}` : `error_${name}`)
  return [
    [key('code'), error.code],
    [key('reason'), error.reason],
    [key('message'), error.detail ?? error.message]
  ]
}
