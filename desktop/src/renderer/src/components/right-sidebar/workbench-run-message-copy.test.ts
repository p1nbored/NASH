import { describe, expect, it } from 'vitest'
import { describeRunMessageResult } from './workbench-run-message-copy'

describe('run message copy', () => {
  it('names the 65,536 code point ceiling for a message that is too long (D-027)', () => {
    const copy = describeRunMessageResult({
      outcome: 'refused',
      reason: 'text_too_long',
      messageId: null,
      state: 'refused',
      duplicate: false
    })
    expect(copy.detail).toContain('65,536')
    expect(copy.detail).not.toContain('4,000')
    expect(copy.tone).toBe('warning')
  })
})
