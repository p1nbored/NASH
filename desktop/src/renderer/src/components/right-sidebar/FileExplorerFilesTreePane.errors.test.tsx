// @vitest-environment happy-dom
import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { FileExplorerFilesTreePane } from './FileExplorerFilesTreePane'
import { FileExplorerTreeStatus } from './FileExplorerTreeStatus'
import { visit, type ReactElementLike } from './file-explorer-element-tree-test-harness'

type Props = ComponentProps<typeof FileExplorerFilesTreePane>
function emptyPane(error?: string, wslHostUnavailable: Props['wslHostUnavailable'] = null) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This element-tree fixture supplies every field read by the empty pane; child components and event handlers are not executed.
  return FileExplorerFilesTreePane({
    worktreePath: '/repo',
    displayRootPath: '/repo/src',
    explorerView: 'files',
    visibleRowCount: 0,
    hasNameFilter: false,
    wslHostUnavailable,
    tree: {
      loadingDirPaths: new Set(),
      rootError: 'Full root unavailable',
      dirCache: { '/repo/src': { children: [], error } }
    },
    selection: {},
    paneState: {
      inlineInputState: {},
      rowScrolling: {},
      handlers: {},
      nodeCommands: {},
      dragDrop: { rootDragHandlers: {} }
    }
  } as unknown as Props)
}

it.each([undefined, 'Permission denied', ''])(
  'uses the selected root error (%j), not a stale full-root error',
  (error) => {
    const elements: ReactElementLike[] = []
    visit(emptyPane(error), (element) => elements.push(element))
    const status = elements.find((element) => element.type === FileExplorerTreeStatus)
    expect(status?.props).toMatchObject({
      isLoading: false,
      error: error ?? null,
      isEmpty: error === undefined
    })
    expect(elements.some((element) => element.props?.role === 'status')).toBe(error !== undefined)
  }
)

it('renders an empty error message as a failed read rather than an empty directory', () => {
  const markup = renderToStaticMarkup(<FileExplorerTreeStatus isLoading={false} error="" isEmpty />)
  expect(markup).toContain('Could not load files for this workspace:')
  expect(markup).not.toContain('No files in this workspace')
})

it('describes the selected folder rather than claiming the whole workspace is empty', () => {
  const markup = renderToStaticMarkup(
    <FileExplorerTreeStatus isLoading={false} error={null} isEmpty scopedToFolder />
  )
  expect(markup).toContain('No files in this folder')
  expect(markup).not.toContain('No files in this workspace')
})

it('identifies a failed folder load without mislabeling workspace availability', () => {
  const markup = renderToStaticMarkup(
    <FileExplorerTreeStatus isLoading={false} error="Permission denied" isEmpty scopedToFolder />
  )
  expect(markup).toContain('Could not load this folder:')
  expect(markup).toContain('Permission denied')
})

it('swaps Retry for the turned-off state when the WSL host is turned off', () => {
  const elements: ReactElementLike[] = []
  visit(emptyPane('WSL hosts are turned off', 'turned-off'), (element) => elements.push(element))
  const status = elements.find((element) => element.type === FileExplorerTreeStatus)
  expect(status?.props).toMatchObject({ wslHostsTurnedOff: true })
  expect(elements.some((element) => element.props?.role === 'status')).toBe(false)
})

it('keeps the read error and Retry when the WSL host is not turned off', () => {
  const elements: ReactElementLike[] = []
  visit(emptyPane('Permission denied', 'server-files-missing'), (element) => elements.push(element))
  const status = elements.find((element) => element.type === FileExplorerTreeStatus)
  expect(status?.props).toMatchObject({ wslHostsTurnedOff: false })
  expect(elements.some((element) => element.props?.role === 'status')).toBe(true)
})

it('offers the WSL Turn on switch instead of a read error', () => {
  const markup = renderToStaticMarkup(
    <FileExplorerTreeStatus isLoading={false} error="unreachable" isEmpty wslHostsTurnedOff />
  )
  expect(markup).toContain('WSL hosts are turned off in Settings → Experimental')
  expect(markup).toContain('Turn on')
  expect(markup).not.toContain('Could not load files for this workspace')
})
