import { describe, expect, it } from 'vitest'
import { createDaemonPtyEnvironment } from './spawn-environment'

// D-017: a terminal NASH hosts must identify itself as NASH, so a TUI never mistakes it for Orca.
describe('createDaemonPtyEnvironment TERM_PROGRAM', () => {
  it('identifies the terminal as NASH, never as Orca', () => {
    const env = createDaemonPtyEnvironment({ sessionId: 'session-1', cols: 80, rows: 24 })

    expect(env.TERM_PROGRAM).toBe('NASH')
    expect(env.TERM_PROGRAM).not.toBe('Orca')
  })
})
