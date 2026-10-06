import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CODEX_EXEC_LIMITS,
  MAX_TIMER_MS,
  resolveRunOptions
} from './codex-exec-run-options'
import { DEFAULT_STREAM_LIMITS } from './codex-exec-stream-state'

// The executable is irrelevant to option resolution; a minimal stand-in keeps the type honest.
const EXECUTABLE = {
  program: '/bin/node',
  prefixArgs: [],
  entryPath: '/bin/codex',
  requestedPath: '/bin/codex',
  launch: 'direct',
  source: 'explicit',
  electronRunAsNode: false
} as const

function resolve(overrides: Record<string, unknown> = {}) {
  return resolveRunOptions({ executable: EXECUTABLE, ...overrides })
}

function detailOf(result: ReturnType<typeof resolve>): string {
  if (result.ok) {
    throw new Error('expected the options to be rejected')
  }
  return result.detail
}

describe('resolveRunOptions defaults', () => {
  it('returns the documented defaults when nothing is given', () => {
    const result = resolve()
    expect(result).toEqual({
      ok: true,
      value: {
        limits: DEFAULT_CODEX_EXEC_LIMITS,
        // D-027: no fixed timeout; a run ends when codex ends or the user stops it.
        timing: { timeoutMs: null, graceMs: 5_000, verifyMs: 10_000 }
      }
    })
  })

  it('does not let an explicit undefined override a default', () => {
    const result = resolve({
      timeoutMs: undefined,
      graceMs: undefined,
      limits: {
        maxLineBytes: undefined,
        maxStderrBytes: undefined,
        stream: { maxEvents: undefined }
      }
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        limits: {
          maxLineBytes: DEFAULT_CODEX_EXEC_LIMITS.maxLineBytes,
          maxStderrBytes: DEFAULT_CODEX_EXEC_LIMITS.maxStderrBytes
        },
        timing: { timeoutMs: null }
      }
    })
    if (result.ok) {
      expect(result.value.limits.stream.maxEvents).toBe(DEFAULT_STREAM_LIMITS.maxEvents)
    }
  })

  it('applies a valid override and leaves the rest at their defaults', () => {
    const result = resolve({
      timeoutMs: 1_000,
      limits: { maxLineBytes: 2048, stream: { maxEvents: 7 } }
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        limits: { maxLineBytes: 2048, maxPromptBytes: DEFAULT_CODEX_EXEC_LIMITS.maxPromptBytes },
        timing: { timeoutMs: 1_000, graceMs: 5_000 }
      }
    })
  })
})

describe('resolveRunOptions numeric validation', () => {
  it.each([1, 1000, MAX_TIMER_MS])('accepts %d', (value) => {
    expect(resolve({ timeoutMs: value, limits: { maxLineBytes: value } }).ok).toBe(true)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative Infinity', Number.NEGATIVE_INFINITY],
    ['above the timer maximum', MAX_TIMER_MS + 1],
    ['a numeric string', '5'],
    ['null', null],
    ['a boolean', true]
  ])('rejects %s for every numeric option', (_label, value) => {
    expect(MAX_TIMER_MS).toBe(2_147_483_647)
    for (const overrides of [
      { timeoutMs: value },
      { graceMs: value },
      { verifyMs: value },
      { limits: { maxLineBytes: value } },
      { limits: { maxStderrBytes: value } },
      { limits: { maxLastMessageBytes: value } },
      { limits: { maxPromptBytes: value } },
      { limits: { drainGraceMs: value } },
      { limits: { stream: { maxEvents: value } } }
    ]) {
      expect(resolve(overrides).ok).toBe(false)
    }
  })

  it('names the offending option without echoing a hostile value', () => {
    expect(detailOf(resolve({ timeoutMs: Number.POSITIVE_INFINITY }))).toContain('timeoutMs')
    expect(detailOf(resolve({ limits: { maxLineBytes: 0 } }))).toContain('limits.maxLineBytes')
    expect(detailOf(resolve({ limits: { stream: { maxEvents: -3 } } }))).toContain(
      'limits.stream.maxEvents'
    )
    expect(detailOf(resolve({ limits: { maxLineBytes: 'SECRET-SENTINEL' } }))).not.toContain(
      'SECRET-SENTINEL'
    )
  })

  it('rejects limits that are not an object', () => {
    expect(resolve({ limits: 5 }).ok).toBe(false)
    expect(resolve({ limits: { stream: 5 } }).ok).toBe(false)
  })
})
