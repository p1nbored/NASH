import { createElement, Fragment, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { Section, Worktree } from '../worktree/workspace-list-types'

const { rowRenders } = vi.hoisted(() => ({ rowRenders: vi.fn() }))

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  // Renders every row through the list's own renderItem, as a mounted SectionList would.
  SectionList: ({
    sections,
    keyExtractor,
    renderItem
  }: {
    sections: Section[]
    keyExtractor: (item: Worktree) => string
    renderItem: (info: { item: Worktree }) => ReactNode
  }) =>
    sections.flatMap((section) =>
      section.data.map((item) =>
        createElement(Fragment, { key: keyExtractor(item) }, renderItem({ item }))
      )
    ),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))
vi.mock('lucide-react-native', () => ({}))
vi.mock('../platform/haptics', () => ({ triggerMediumImpact: vi.fn() }))
vi.mock('../components/AgentSpinner', () => ({ AgentSpinner: () => null }))
vi.mock('../components/MobileRepoIcon', () => ({ MobileRepoIcon: () => null }))
vi.mock('../components/WorktreeAgentList', () => ({ WorktreeAgentList: () => null }))
// The row always renders the glyphs, so each call is one row render, named by its comment.
vi.mock('../components/WorktreeMetaGlyphs', () => ({
  prStateColor: () => '#000000',
  WorktreeMetaGlyphs: ({ comment }: { comment?: string }) => {
    rowRenders(comment)
    return null
  }
}))
// Off this embedded path; mocked for their native imports.
vi.mock('../components/MobileSearchField', () => ({}))
vi.mock('../components/NewWorkspaceFab', () => ({ FAB_SIZE: 56 }))

import { buildSections } from '../worktree/workspace-list-sections'
import { HostWorkspaceList } from './host-workspace-list'

function worktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  return {
    worktreeId: `repo-1::${id}`,
    repoId: 'repo-1',
    repo: 'orca',
    branch: `feature/${id}`,
    displayName: id,
    path: id,
    liveTerminalCount: 1,
    hasAttachedPty: true,
    unread: false,
    isPinned: false,
    linkedPR: null,
    comment: id,
    status: 'active',
    ...overrides
  }
}

const noop = () => {}
const stable = { ref: { current: null }, repoColors: new Map(), repoIcons: new Map() }

function listProps(worktrees: Worktree[]) {
  // Each poll re-parses the payload, so rows are fresh objects even when nothing changed.
  const polled: Worktree[] = JSON.parse(JSON.stringify(worktrees))
  const filters = {
    filterRepoIds: new Set<string>(),
    hideSleeping: false,
    hideDefaultBranch: false
  }
  const sections = buildSections(polled, 'name', filters, '', 'none', new Set())
  const controller = {
    actions: { openWorktreeSession: noop, openNewWorktreeModal: noop },
    activeWorktreeScroll: { sectionListRef: stable.ref, onScrollToIndexFailed: noop },
    catalog: { refreshing: false, onRefresh: noop },
    connState: 'connected',
    displayWorktrees: polled,
    embedded: true,
    insets: { bottom: 0 },
    isReadOnly: false,
    now: 1_000,
    reconnectAttempts: 0,
    relayRecovery: { pairingRejected: false },
    sectionsResult: { rawSections: sections, sections, uniqueRepoColors: stable.repoColors },
    settings: { activeFilterCount: 0, toggleWorktreeLineage: noop },
    state: {
      actionError: '',
      setActionTarget: noop,
      groupMode: 'none',
      repoIconsByName: stable.repoIcons,
      search: '',
      showSearch: false,
      worktreesLoaded: true
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the list reads only the controller fields above on this connected, embedded, error-free path.
  return { controller } as unknown as Parameters<typeof HostWorkspaceList>[0]
}

describe('host list rows across polls', () => {
  it('re-renders only the row whose worktree changed', () => {
    const rows = [worktree('a'), worktree('b'), worktree('c')]
    let tree: ReactTestRenderer | null = null
    act(() => {
      tree = create(createElement(HostWorkspaceList, listProps(rows)))
    })
    rowRenders.mockClear()

    const changed = [rows[0]!, { ...rows[1]!, branch: 'feature/b-renamed' }, rows[2]!]
    act(() => tree!.update(createElement(HostWorkspaceList, listProps(changed))))

    expect(rowRenders.mock.calls.map(([comment]) => comment)).toEqual(['b'])
    act(() => tree!.unmount())
  })
})
