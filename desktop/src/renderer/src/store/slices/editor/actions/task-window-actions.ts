import type { WorkbenchRunTaskAttempt } from '../../../../../../shared/rpc-contract/workbench-task-window-params'
import {
  buildTaskWindowTabId,
  getTaskWindowTabLabel,
  type OpenTaskWindowState
} from '@/components/task-window/task-window-tab'
import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import type { OpenFile } from '../types/open-file'
import { openWorkspaceEditorItem } from '../tabs/workspace-editor-item'

function withTaskWindow(
  openFiles: readonly OpenFile[],
  fileId: string,
  change: (current: OpenTaskWindowState) => OpenTaskWindowState | null
): OpenFile[] | null {
  const file = openFiles.find((candidate) => candidate.id === fileId)
  const next = file?.mode === 'task-window' && file.taskWindow ? change(file.taskWindow) : null
  return next
    ? openFiles.map((candidate) =>
        candidate.id === fileId ? { ...candidate, taskWindow: next } : candidate
      )
    : null
}

/** D-024: the read-only task window tab, a transient virtual editor tab like check details. */
export function createTaskWindowActions(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'openTaskWindow' | 'selectTaskWindowAttempt' | 'patchTaskWindowAttempts'> {
  return {
    openTaskWindow: (worktreeId, input) => {
      const id = buildTaskWindowTabId(worktreeId, input.taskId)
      const label = getTaskWindowTabLabel(input)
      set((s) => {
        const active = {
          activeFileId: id,
          activeTabType: 'editor' as const,
          activeFileIdByWorktree: { ...s.activeFileIdByWorktree, [worktreeId]: id },
          activeTabTypeByWorktree: { ...s.activeTabTypeByWorktree, [worktreeId]: 'editor' as const }
        }
        if (s.openFiles.some((file) => file.id === id)) {
          return {
            ...active,
            openFiles: s.openFiles.map((file) =>
              file.id === id ? { ...file, relativePath: label, taskWindow: input } : file
            )
          }
        }
        const newFile: OpenFile = {
          id,
          filePath: id,
          relativePath: label,
          worktreeId,
          language: 'plaintext',
          isDirty: false,
          mode: 'task-window',
          taskWindow: input
        }
        return { ...active, openFiles: [...s.openFiles, newFile] }
      })
      // Why check-details: the tab system's transient virtual kind; a new kind would change the saved session schema.
      void openWorkspaceEditorItem(get(), id, worktreeId, label, 'check-details')
    },

    selectTaskWindowAttempt: (fileId, dispatchId) => {
      set((s) => {
        const openFiles = withTaskWindow(s.openFiles, fileId, (current) =>
          current.attempts.some((entry) => entry.dispatchId === dispatchId)
            ? { ...current, selectedDispatchId: dispatchId }
            : null
        )
        return openFiles ? { openFiles } : s
      })
    },

    patchTaskWindowAttempts: (fileId, attempts: readonly WorkbenchRunTaskAttempt[]) => {
      set((s) => {
        // Why compare: the tab re-reads its task every few seconds, and an unchanged list must not re-render editors.
        const openFiles = withTaskWindow(s.openFiles, fileId, (current) =>
          JSON.stringify(current.attempts) === JSON.stringify(attempts)
            ? null
            : { ...current, attempts }
        )
        return openFiles ? { openFiles } : s
      })
    }
  }
}
