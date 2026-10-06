// Numeric options are checked once, up front, so no timer or cap can be disabled by a bad value.

/** setTimeout reads anything larger as 1 ms, so every duration stops here. */
export const MAX_TIMER_MS = 2_147_483_647

export class OptionError extends Error {}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An absent entry keeps its default; anything present must be a positive integer a timer can hold. */
export function readPositiveCount(name: string, value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback
  }
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_TIMER_MS
  ) {
    throw new OptionError(`${name} must be an integer from 1 to ${MAX_TIMER_MS}.`)
  }
  return value
}

/** An absent duration arms no timer at all (D-027); a present one is checked like any count. */
export function readOptionalPositiveCount(name: string, value: unknown): number | null {
  return value === undefined ? null : readPositiveCount(name, value, MAX_TIMER_MS)
}

export function readOptionRecord(name: string, value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {}
  }
  if (!isPlainRecord(value)) {
    throw new OptionError(`${name} must be an object.`)
  }
  return value
}
