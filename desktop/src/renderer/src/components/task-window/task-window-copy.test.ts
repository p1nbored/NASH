import { describe, expect, it } from 'vitest'
import { attemptStateKind } from './task-window-copy'

describe('attemptStateKind', () => {
  it('gives failed, blocked and unconfirmed attempts their own problem kinds', () => {
    expect(attemptStateKind('failed')).toBe('failed')
    expect(attemptStateKind('blocked')).toBe('blocked')
    expect(attemptStateKind('stop_unknown')).toBe('disconnected')
    expect(attemptStateKind('start_unknown')).toBe('disconnected')
  })

  it('never reads an unknown state as success', () => {
    expect(attemptStateKind('completed')).toBe('done')
    expect(attemptStateKind('something_new')).toBe('unknown')
    expect(attemptStateKind('toString')).toBe('unknown')
    expect(attemptStateKind(null)).toBe('progress')
  })
})
