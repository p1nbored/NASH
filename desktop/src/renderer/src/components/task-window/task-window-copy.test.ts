import { describe, expect, it } from 'vitest'
import { sandboxLabel } from './task-window-copy'

// D-025: a write attempt in a git workspace has its own worktree; in a folder workspace it writes in place.

describe('sandboxLabel', () => {
  it('says a write attempt writes in its own worktree only when the start record names one', () => {
    expect(sandboxLabel('write', true)).toBe('Writes in its own worktree')
    expect(sandboxLabel('write', false)).toBe('Writes in the workspace folder')
  })

  it('keeps the read-only and unrecorded labels whatever the worktree', () => {
    expect(sandboxLabel('read-only', false)).toBe('Read only')
    expect(sandboxLabel(null, false)).toBe('Not recorded')
    expect(sandboxLabel('something-new', true)).toBe('Not recorded')
  })
})
