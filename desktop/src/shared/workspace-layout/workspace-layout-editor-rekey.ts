// Editor tabs follow a file renamed on disk. An editor tab and its file record are keyed by the
// file's path, so a rename rekeys both; two open files are never merged into one tab.

import { applied, refuse, type Applied } from './workspace-layout-command-steps'
import type { LayoutEditorFile, WorkspaceLayoutModel } from './workspace-layout-model'
import { withWorkspace } from './workspace-layout-removal'

/** One renamed file; the rename boundary expands a renamed folder into its open files. */
export type EditorFileRename = {
  fromFilePath: string
  toFilePath: string
  toRelativePath: string
  /** Set when the new name changes the file's language. */
  toLanguage?: string
}

/**
 * Refused as a whole when two files would land on one path, or a file would land on an open one
 * that is not itself moving away. Files that are not open are ignored.
 */
export function renameEditorFiles(
  model: WorkspaceLayoutModel,
  workspaceKey: string,
  renames: readonly EditorFileRename[]
): Applied {
  const workspace = model.workspaces[workspaceKey]
  if (!workspace) {
    return applied(model)
  }
  const openPaths = new Set(
    workspace.tabs.flatMap((tab) => (tab.kind === 'editor' ? [tab.entityId] : []))
  )
  const moves = new Map(
    renames
      .filter((rename) => openPaths.has(rename.fromFilePath))
      .map((rename) => [rename.fromFilePath, rename])
  )
  if (moves.size === 0) {
    return applied(model)
  }
  const targets = new Set<string>()
  for (const { toFilePath } of moves.values()) {
    if (targets.has(toFilePath) || (openPaths.has(toFilePath) && !moves.has(toFilePath))) {
      return refuse('invalid_params')
    }
    targets.add(toFilePath)
  }
  const renamedPath = (path: string) => moves.get(path)?.toFilePath ?? path
  // A tab-bar id that is the file's path follows it too.
  const renamedTabIds = new Map<string, string>()
  const tabs = workspace.tabs.map((tab) => {
    if (tab.kind !== 'editor' || !moves.has(tab.entityId)) {
      return tab
    }
    const id = tab.id === tab.entityId ? renamedPath(tab.id) : tab.id
    renamedTabIds.set(tab.id, id)
    return { ...tab, id, entityId: renamedPath(tab.entityId) }
  })
  const groups = workspace.groups.map((group) => ({
    ...group,
    tabOrder: group.tabOrder.map((id) => renamedTabIds.get(id) ?? id)
  }))
  const editorFiles = workspace.editorFiles?.map((file): LayoutEditorFile => {
    const rename = moves.get(file.filePath)
    return rename
      ? {
          ...file,
          filePath: rename.toFilePath,
          relativePath: rename.toRelativePath,
          ...(rename.toLanguage !== undefined ? { language: rename.toLanguage } : {})
        }
      : file
  })
  return applied(
    withWorkspace(model, workspaceKey, {
      ...workspace,
      tabs,
      groups,
      ...(editorFiles ? { editorFiles } : {})
    }),
    { renamedTabIds: Object.fromEntries([...renamedTabIds].filter(([from, to]) => from !== to)) }
  )
}
