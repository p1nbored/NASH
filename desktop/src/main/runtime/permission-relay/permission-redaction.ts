import { maskSecretLikeText } from '../../agent-exec-shared/secret-shapes'
import { PERMISSION_SUMMARY_MAX_CHARS } from '../orchestration/db/autopilot-run-schema-definition'
import {
  TOOL_SUMMARY_DETAILS,
  isDesktopOnlyTool,
  type PermissionRelayInput
} from './permission-audience'

/**
 * Builds the one line dot and the desktop see for a prompt (D-017): the tool, the command or the
 * file names, with credentials masked; never file contents. The result is a fixed point of
 * `maskSecretLikeText`, so the store, which refuses rather than masks, accepts it unchanged.
 */
export const DESKTOP_ONLY_SUMMARY_PREFIX = 'Desktop only. '

const PREFIX_CODE_POINTS = Array.from(DESKTOP_ONLY_SUMMARY_PREFIX).length
/** Every body leaves room for the prefix, so marking a prompt desktop-only never cuts it again. */
export const PERMISSION_SUMMARY_BODY_MAX = PERMISSION_SUMMARY_MAX_CHARS - PREFIX_CODE_POINTS
const ELLIPSIS = '…'
const MAX_ROUNDS = 8

const LONE_SURROGATES = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
// Why: direction overrides and invisible marks can make a line read differently from what runs.
const FORMAT_CHARACTERS = /\p{Cf}/gu
const LINE_BREAKS_AND_CONTROLS = /[\p{Cc}\p{Zl}\p{Zp}]+/gu

function toOneLine(text: string): string {
  return text
    .replace(LONE_SURROGATES, '�')
    .replace(FORMAT_CHARACTERS, '�')
    .replace(LINE_BREAKS_AND_CONTROLS, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

function codePointLength(text: string): number {
  return Array.from(text).length
}

function cut(text: string, budget: number): string {
  return `${Array.from(text)
    .slice(0, Math.max(0, budget - 1))
    .join('')}${ELLIPSIS}`
}

/**
 * Masks, folds to one line and cuts to `max` code points, repeating until masking changes nothing.
 * A cut can expose a credential flag or split a masked span, so each further round cuts shorter.
 * Returns null when no stable line results; the caller then refuses instead of storing it.
 */
export function redactPermissionLine(
  text: string,
  max: number
): { text: string; truncated: boolean } | null {
  let current = toOneLine(text)
  let budget = max
  let truncated = false
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const masked = toOneLine(maskSecretLikeText(current))
    const fits = codePointLength(masked) <= max
    if (fits && masked === current) {
      return current ? { text: current, truncated } : null
    }
    if (fits) {
      current = masked
      continue
    }
    truncated = true
    current = cut(masked, budget)
    budget = Math.max(1, Math.floor(budget * 0.9))
  }
  return null
}

function displayPath(path: string, cwd: string | null): string {
  if (!cwd) {
    return path
  }
  const base = cwd.replace(/[\\/]+$/, '')
  const windows = /^[A-Za-z]:[\\/]/.test(base) || base.startsWith('\\\\')
  const head = path.slice(0, base.length)
  const sameBase = windows ? head.toLowerCase() === base.toLowerCase() : head === base
  const separator = path.charAt(base.length)
  const inside = sameBase && (separator === '/' || separator === '\\')
  return inside && path.length > base.length + 1 ? path.slice(base.length + 1) : path
}

function summaryBody(input: PermissionRelayInput): string {
  const detail = TOOL_SUMMARY_DETAILS[input.toolName]
  const value = detail ? input.toolInput[detail.required]?.trim() : undefined
  if (!detail || !value) {
    return input.toolName
  }
  const { cwd, toolInput } = input
  if (detail.required === 'command') {
    return `${input.toolName}: ${value}`
  }
  if (input.toolName === 'Glob') {
    return toolInput.path
      ? `Glob: ${value} in ${displayPath(toolInput.path, cwd)}`
      : `Glob: ${value}`
  }
  if (input.toolName === 'Grep') {
    return `Grep: in ${displayPath(value, cwd)}`
  }
  return `${input.toolName}: ${displayPath(value, cwd)}`
}

/**
 * The stored summary. A body that had to be cut is desktop-only too: dot never approves a command
 * it cannot read in full. Returns null when the line cannot be made safe to store.
 */
export function buildPermissionSummary(
  input: PermissionRelayInput,
  desktopOnly: boolean
): { summary: string; desktopOnly: boolean } | null {
  const body = redactPermissionLine(summaryBody(input), PERMISSION_SUMMARY_BODY_MAX)
  if (!body) {
    return null
  }
  const marked = desktopOnly || body.truncated
  const summary = marked ? `${DESKTOP_ONLY_SUMMARY_PREFIX}${body.text}` : body.text
  if (
    maskSecretLikeText(summary) !== summary ||
    codePointLength(summary) > PERMISSION_SUMMARY_MAX_CHARS
  ) {
    return null
  }
  return { summary, desktopOnly: marked }
}

export function isDesktopOnlySummary(summary: string): boolean {
  return summary.startsWith(DESKTOP_ONLY_SUMMARY_PREFIX)
}

/** A stored prompt dot may not see or answer: by its tool, or by the mark set when it was recorded. */
export function isDesktopOnlyRecord(record: { toolName: string; summary: string }): boolean {
  return isDesktopOnlyTool(record.toolName) || isDesktopOnlySummary(record.summary)
}
