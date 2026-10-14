import { describe, expect, it } from 'vitest'
import { build, testContext, WS } from './workspace-layout-command.test-fixture'
import type { LayoutEditorFile, WorkspaceLayoutModel } from './workspace-layout-model'
import { checkWorkspaceLayoutModelRules } from './workspace-layout-model-rules'
import { applyLayoutTransition } from './workspace-layout-transitions'
import type { EditorFileRename } from './workspace-layout-editor-rekey'

const file = (filePath: string): LayoutEditorFile => ({
  filePath,
  relativePath: filePath.replace('/repo/', ''),
  language: 'typescript'
})

/** Editor tabs for a.ts and b.ts, and a terminal. */
function setup() {
  return build(testContext(), [
    { type: 'createTerminalTab', workspace: WS },
    ...['/repo/a.ts', '/repo/b.ts'].map((path) => ({
      type: 'openEditorTab' as const,
      workspace: WS,
      fileId: path,
      contentType: 'editor' as const,
      file: file(path)
    }))
  ]).model
}

function rename(model: WorkspaceLayoutModel, renames: EditorFileRename[]) {
  const result = applyLayoutTransition(model, {
    type: 'editorFilesRenamed',
    workspace: WS,
    renames
  })
  if (result.ok) {
    expect(checkWorkspaceLayoutModelRules([result.model], [model])).toEqual([])
  }
  return result
}

const editors = (model: WorkspaceLayoutModel) => ({
  tabs: model.workspaces[WS]!.tabs.flatMap((tab) => (tab.kind === 'editor' ? [tab.entityId] : [])),
  files: model.workspaces[WS]!.editorFiles!.map((entry) => [
    entry.filePath,
    entry.relativePath,
    entry.language
  ])
})

describe('editor tabs follow a rename', () => {
  it('rekeys the tab and its file record, keeping the tab-bar id and order', () => {
    const model = setup()
    const before = model.workspaces[WS]!
    const result = rename(model, [
      {
        fromFilePath: '/repo/a.ts',
        toFilePath: '/repo/src/a.md',
        toRelativePath: 'src/a.md',
        toLanguage: 'markdown'
      }
    ])
    expect(result.ok && editors(result.model)).toEqual({
      tabs: ['/repo/src/a.md', '/repo/b.ts'],
      files: [
        ['/repo/src/a.md', 'src/a.md', 'markdown'],
        ['/repo/b.ts', 'b.ts', 'typescript']
      ]
    })
    expect(result.ok && result.model.workspaces[WS]!.groups).toEqual(before.groups)
    expect(result.ok && result.result.renamedTabIds).toEqual({})
    expect(result.ok && result.model.workspaces[WS]!.tabs.map((tab) => tab.id)).toEqual(
      before.tabs.map((tab) => tab.id)
    )
  })

  it('swaps two open files, and rekeys back on a rollback rename', () => {
    const model = setup()
    const swapped = rename(model, [
      { fromFilePath: '/repo/a.ts', toFilePath: '/repo/b.ts', toRelativePath: 'b.ts' },
      { fromFilePath: '/repo/b.ts', toFilePath: '/repo/a.ts', toRelativePath: 'a.ts' }
    ])
    expect(swapped.ok && editors(swapped.model).tabs).toEqual(['/repo/b.ts', '/repo/a.ts'])
    const moved = rename(model, [
      { fromFilePath: '/repo/a.ts', toFilePath: '/repo/c.ts', toRelativePath: 'c.ts' }
    ])
    const back =
      moved.ok &&
      rename(moved.model, [
        { fromFilePath: '/repo/c.ts', toFilePath: '/repo/a.ts', toRelativePath: 'a.ts' }
      ])
    expect(back && back.ok && editors(back.model)).toEqual(editors(model))
  })

  it('never merges two open files and ignores files that are not open', () => {
    const model = setup()
    expect(
      rename(model, [
        { fromFilePath: '/repo/a.ts', toFilePath: '/repo/b.ts', toRelativePath: 'b.ts' }
      ])
    ).toEqual({ ok: false, code: 'invalid_params' })
    expect(
      rename(model, [
        { fromFilePath: '/repo/a.ts', toFilePath: '/repo/c.ts', toRelativePath: 'c.ts' },
        { fromFilePath: '/repo/b.ts', toFilePath: '/repo/c.ts', toRelativePath: 'c.ts' }
      ])
    ).toEqual({ ok: false, code: 'invalid_params' })
    const closed = rename(model, [
      { fromFilePath: '/repo/x.ts', toFilePath: '/repo/y.ts', toRelativePath: 'y.ts' }
    ])
    expect(closed.ok && closed.model).toEqual(model)
  })

  it('moves a tab-bar id that is the file path with it, in the tab order too', () => {
    const model = setup()
    const workspace = model.workspaces[WS]!
    const tabId = workspace.tabs.find((tab) => tab.entityId === '/repo/a.ts')!.id
    const pathIds: WorkspaceLayoutModel = {
      ...model,
      workspaces: {
        [WS]: {
          ...workspace,
          tabs: workspace.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, id: '/repo/a.ts' } : tab
          ),
          groups: workspace.groups.map((group) => ({
            ...group,
            tabOrder: group.tabOrder.map((id) => (id === tabId ? '/repo/a.ts' : id))
          }))
        }
      }
    }
    const result = rename(pathIds, [
      { fromFilePath: '/repo/a.ts', toFilePath: '/repo/c.ts', toRelativePath: 'c.ts' }
    ])
    expect(result.ok && result.model.workspaces[WS]!.groups[0]!.tabOrder).toContain('/repo/c.ts')
    expect(
      result.ok && result.model.workspaces[WS]!.tabs.some((tab) => tab.id === '/repo/c.ts')
    ).toBe(true)
    expect(result.ok && result.result.renamedTabIds).toEqual({ '/repo/a.ts': '/repo/c.ts' })
  })
})
