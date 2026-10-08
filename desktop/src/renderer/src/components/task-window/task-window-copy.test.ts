import { describe, expect, it } from 'vitest'
import { attemptStateKind, sandboxLabel, stepStatusLabel, toolStepLabel } from './task-window-copy'

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

describe('transcript step labels', () => {
  it('words Codex item types and statuses instead of showing them raw', () => {
    expect(toolStepLabel('web_search')).toBe('Web search')
    expect(toolStepLabel('mcp_tool_call')).toBe('MCP tool call')
    expect(toolStepLabel('brand_new_item')).toBe('Tool step')
    expect(stepStatusLabel('in_progress')).toBe('Running')
    expect(stepStatusLabel('completed')).toBe('Completed')
    expect(stepStatusLabel('failed')).toBe('Failed')
    expect(stepStatusLabel('declined')).toBeNull()
  })
})
