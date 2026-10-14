import { describe, expect, it, vi } from 'vitest'
import {
  getNextTerminalReadyRetryAttempt,
  READY_MAX_ATTEMPTS
} from './OnboardingInlineCommandTerminal'

vi.mock('@/components/terminal-pane/TerminalPane', () => ({
  default: () => {
    throw new Error('This suite must not render a terminal pane')
  }
}))

describe('getNextTerminalReadyRetryAttempt', () => {
  it('stops scheduling readiness checks after the capped number of attempts', () => {
    let attempt = 0
    let scheduledRetries = 0

    while (true) {
      const nextAttempt = getNextTerminalReadyRetryAttempt(attempt)
      if (nextAttempt === null) {
        break
      }
      scheduledRetries += 1
      attempt = nextAttempt
    }

    expect(scheduledRetries).toBe(READY_MAX_ATTEMPTS)
    expect(attempt).toBe(READY_MAX_ATTEMPTS)
    expect(getNextTerminalReadyRetryAttempt(READY_MAX_ATTEMPTS)).toBeNull()
  })
})
