import { describe, expect, it, vi } from 'vitest'
import { buildEditorSessionData } from '@/lib/workspace-session'
import type { WorkbenchRunTaskAttempt } from '../../../../shared/rpc-contract/workbench-task-window-params'
import { createEditorTabsStore } from './editor-slice-test-harness'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/runtime/close-mirrored-editor-tab', () => ({
  notifyHostOfMirroredEditorClose: vi.fn()
}))

// FIXTURE_ONLY attempts; no runtime is read.
function attempt(dispatchId: string, state = 'running'): WorkbenchRunTaskAttempt {
  return {
    dispatchId,
    state,
    startedAt: '2026-10-05T18:00:00.000Z',
    settledAt: null,
    hasTranscript: true,
    worktree: null
  }
}

const OPEN = {
  runId: 'run_fixture01',
  taskId: 'task_fixture01',
  title: 'Review the parser',
  executorKind: 'codex' as const,
  attempts: [attempt('ctx_first', 'failed'), attempt('ctx_second')],
  selectedDispatchId: 'ctx_second'
}
const TAB_ID = 'wt-1::task-window::task_fixture01'

describe('task window tabs', () => {
  it('opens a read-only virtual tab named after the executor and the task', () => {
    const store = createEditorTabsStore()
    store.getState().openTaskWindow('wt-1', OPEN)

    const state = store.getState()
    expect(state.activeFileId).toBe(TAB_ID)
    expect(state.openFiles).toEqual([
      expect.objectContaining({
        id: TAB_ID,
        filePath: TAB_ID,
        relativePath: 'Codex · Review the parser',
        worktreeId: 'wt-1',
        mode: 'task-window',
        isDirty: false,
        taskWindow: OPEN
      })
    ])
    // Why check-details: the tab system's transient virtual editor kind, never persisted.
    expect(state.unifiedTabsByWorktree['wt-1']).toEqual([
      expect.objectContaining({ entityId: TAB_ID, contentType: 'check-details' })
    ])
  })

  it('reuses the task tab for another attempt and selects that attempt', () => {
    const store = createEditorTabsStore()
    store.getState().openTaskWindow('wt-1', OPEN)
    store.getState().openTaskWindow('wt-1', { ...OPEN, selectedDispatchId: 'ctx_first' })

    const state = store.getState()
    expect(state.openFiles).toHaveLength(1)
    expect(state.unifiedTabsByWorktree['wt-1']).toHaveLength(1)
    expect(state.openFiles[0].taskWindow?.selectedDispatchId).toBe('ctx_first')
  })

  it('names an agy task and a task without a title', () => {
    const store = createEditorTabsStore()
    store.getState().openTaskWindow('wt-1', {
      ...OPEN,
      taskId: 'task_fixture02',
      title: null,
      executorKind: 'agy'
    })

    expect(store.getState().openFiles[0].relativePath).toBe('agy · Untitled task')
  })

  it('selects an attempt and refreshes the attempt list without losing the selection', () => {
    const store = createEditorTabsStore()
    store.getState().openTaskWindow('wt-1', OPEN)
    store.getState().selectTaskWindowAttempt(TAB_ID, 'ctx_first')
    const refreshed = [...OPEN.attempts, attempt('ctx_third')]
    store.getState().patchTaskWindowAttempts(TAB_ID, refreshed)

    const taskWindow = store.getState().openFiles[0].taskWindow
    expect(taskWindow?.selectedDispatchId).toBe('ctx_first')
    expect(taskWindow?.attempts.map((entry) => entry.dispatchId)).toEqual([
      'ctx_first',
      'ctx_second',
      'ctx_third'
    ])
  })

  it('ignores a selection or patch for a tab that is not open', () => {
    const store = createEditorTabsStore()
    store.getState().openTaskWindow('wt-1', OPEN)
    const before = store.getState().openFiles
    store.getState().selectTaskWindowAttempt('wt-1::task-window::other', 'ctx_first')
    store.getState().patchTaskWindowAttempts('wt-1::task-window::other', [])
    store.getState().selectTaskWindowAttempt(TAB_ID, 'ctx_not_an_attempt')

    expect(store.getState().openFiles).toBe(before)
  })

  it('is never written to the saved session', () => {
    const store = createEditorTabsStore()
    store.getState().openTaskWindow('wt-1', OPEN)
    const state = store.getState()

    const saved = buildEditorSessionData(
      state.openFiles,
      state.editorDrafts,
      state.markdownFrontmatterVisible,
      state.activeFileIdByWorktree,
      state.activeTabTypeByWorktree
    )
    expect(saved.openFilesByWorktree).toEqual({})
  })
})
