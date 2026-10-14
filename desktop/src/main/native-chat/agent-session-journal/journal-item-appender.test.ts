import { describe, expect, it } from 'vitest'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session-journal-types'
import { JournalItemAppender } from './journal-item-appender'
import { createJournalReducerState } from './journal-reducer'
import type { JournalRow } from './journal-row-schema'

const OPTIONS = { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }

describe('a resolved append that finds nothing', () => {
  // A shared module-level Error would pin the bundle's startup frames for the whole session.
  it('never reuses one thrown object across appends', async () => {
    const thrown: unknown[] = []
    const appender = new JournalItemAppender({
      state: () => createJournalReducerState('session-1', 'epoch-1'),
      enqueue: (build: (seq: number, ts: number) => JournalRow) => {
        try {
          return Promise.resolve(build(1, 0))
        } catch (error) {
          thrown.push(error)
          return Promise.reject(error)
        }
      }
    })

    await expect(appender.appendResolved(() => null, OPTIONS)).resolves.toBeNull()
    await expect(appender.appendResolved(() => null, OPTIONS)).resolves.toBeNull()
    expect(new Set(thrown).size).toBe(thrown.length)
  })
})
