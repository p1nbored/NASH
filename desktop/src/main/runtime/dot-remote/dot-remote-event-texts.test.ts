import { describe, expect, it } from 'vitest'
import { dotRemoteEnglishLine } from '../../../shared/dot-remote/dot-remote-primitives'
import {
  DOT_REMOTE_DELIVERABLE_FALLBACK,
  DOT_REMOTE_VALIDATION_FALLBACKS,
  remoteEventLine
} from './dot-remote-event-texts'

// FIXTURE_ONLY: the secret-shaped value is synthetic.
const FAKE_KEY = 'sk-ant-api03-FIXTUREONLY000000000000000000000000000000000000'

describe('remote event text', () => {
  it('keeps a short English line as it is', () => {
    expect(remoteEventLine('Validation passed: all 3 checks passed.', 300, 'Fallback.')).toBe(
      'Validation passed: all 3 checks passed.'
    )
  })

  it('folds line breaks and runs of space into one line', () => {
    expect(remoteEventLine('Done.\n\nAll   checks\tpassed.', 300, 'Fallback.')).toBe(
      'Done. All checks passed.'
    )
  })

  it('replaces every path-like token, so no path leaves the PC', () => {
    const line = remoteEventLine(
      'Updated docs/plan.md and C:\\Users\\fixture\\notes.txt as asked.',
      300,
      'Fallback.'
    )
    expect(line).toBe('Updated [path] and [path] as asked.')
    expect(line).not.toMatch(/[\\/]/)
  })

  it('falls back when a secret shape remains', () => {
    expect(remoteEventLine(`The key is ${FAKE_KEY}.`, 300, 'Fallback.')).not.toContain(FAKE_KEY)
  })

  it('falls back when the text is too long, empty, missing or not English', () => {
    expect(remoteEventLine('word '.repeat(80), 300, 'Fallback.')).toBe('Fallback.')
    expect(remoteEventLine('   ', 300, 'Fallback.')).toBe('Fallback.')
    expect(remoteEventLine(null, 300, 'Fallback.')).toBe('Fallback.')
    expect(
      remoteEventLine('検証は合格しました。すべてのチェックが通りました。', 300, 'Fallback.')
    ).toBe('Fallback.')
  })

  it('uses fallbacks that themselves fit their event schemas', () => {
    for (const line of Object.values(DOT_REMOTE_VALIDATION_FALLBACKS)) {
      expect(dotRemoteEnglishLine(300, 'x').safeParse(line).success, line).toBe(true)
    }
    expect(dotRemoteEnglishLine(2000, 'x').safeParse(DOT_REMOTE_DELIVERABLE_FALLBACK).success).toBe(
      true
    )
  })
})
