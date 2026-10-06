import { dotRemoteEnglishLine } from '../../../shared/dot-remote/dot-remote-primitives'
import { hasSecretLikeText, maskSecretLikeText } from '../../agent-exec-shared/secret-shapes'

// The free text NASH puts into an event: a C5 validation record line or the D1 run summary. It must
// fit the event schema (one English line, bounded), carry no secret shape and name no path. When it
// does not, the event carries a fixed English line instead, never a cut or partly masked text.

export const DOT_REMOTE_VALIDATION_FALLBACKS = {
  pass: 'Validation passed.',
  fail: 'Validation failed. The details are in the NASH app.',
  inconclusive: 'Validation is inconclusive and waits for a decision by the user or dot.'
} as const

export const DOT_REMOTE_DELIVERABLE_FALLBACK =
  'The run completed. Its summary and files are in the NASH app.'

const PATH_TOKEN = /\S*[\\/]\S*/g
const PATH_MASK = '[path]'

function oneLine(text: string): string {
  return text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** One schema-valid English line from free text, or the fallback. */
export function remoteEventLine(text: string | null, maxChars: number, fallback: string): string {
  if (text === null) {
    return fallback
  }
  const masked = maskSecretLikeText(oneLine(text).replace(PATH_TOKEN, PATH_MASK))
  if (hasSecretLikeText(masked)) {
    return fallback
  }
  return dotRemoteEnglishLine(maxChars, 'remote event line').safeParse(masked).success
    ? masked
    : fallback
}
