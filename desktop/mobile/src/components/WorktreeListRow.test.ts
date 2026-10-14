import {
  createElement,
  Fragment,
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import { Text } from 'react-native'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { WorktreeAgentRow } from './WorktreeAgentRow'
import type { Worktree } from '../worktree/workspace-list-types'
import { WorktreeListRow } from './WorktreeListRow'

const { agentSpinnerRender, agentStateDotRender } = vi.hoisted(() => ({
  agentSpinnerRender: vi.fn(),
  agentStateDotRender: vi.fn()
}))

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  Bell: 'Bell',
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  GitBranch: 'GitBranch',
  GitPullRequest: 'GitPullRequest',
  Monitor: 'Monitor',
  Server: 'Server'
}))

vi.mock('../platform/haptics', () => ({ triggerMediumImpact: vi.fn() }))
vi.mock('./AgentSpinner', () => ({
  AgentSpinner: (props: unknown) => {
    agentSpinnerRender(props)
    return null
  }
}))
vi.mock('./AgentStateDot', () => ({
  AgentStateDot: (props: unknown) => {
    agentStateDotRender(props)
    return null
  }
}))
vi.mock('./MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))
vi.mock('./MobileRepoIcon', () => ({ MobileRepoIcon: () => null }))
vi.mock('./WorktreeAgentList', () => ({ WorktreeAgentList: () => null }))
vi.mock('./WorktreeMetaGlyphs', () => ({
  prStateColor: () => '#000000',
  WorktreeMetaGlyphs: () => null
}))

type TestItem = Worktree & { status: NonNullable<Worktree['status']> }

const stableRepoIcon = { type: 'emoji', emoji: 'o' } as const
let updateSibling: Dispatch<SetStateAction<number>> = () => undefined

function ListRowHarness({ item, now }: { item: TestItem; now: number }) {
  const [sibling, setSibling] = useState(0)
  updateSibling = setSibling
  const onPress = useCallback(() => undefined, [])
  const onLongPress = useCallback(() => undefined, [])
  const onToggleLineage = useCallback(() => undefined, [])

  // Sibling state changes re-render the harness without changing the row's props,
  // exercising the row's React.memo bailout.
  return createElement(
    Fragment,
    null,
    createElement(Text, null, sibling),
    createElement(WorktreeListRow, {
      item,
      isReadOnly: false,
      now,
      repoColor: '#000000',
      repoIcon: stableRepoIcon,
      hideRepo: false,
      status: item.status,
      onPress,
      onLongPress,
      onToggleLineage
    })
  )
}

function agent(overrides: Partial<RuntimeWorktreeAgentRow> = {}): RuntimeWorktreeAgentRow {
  return {
    paneKey: 'agent-1',
    parentPaneKey: null,
    state: 'working',
    agentType: null,
    prompt: 'Fix the list',
    taskTitle: null,
    displayName: null,
    lastAssistantMessage: null,
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: 1_000,
    updatedAt: 1_000,
    ...overrides
  }
}

const baseItem: TestItem = {
  worktreeId: 'worktree-1',
  repoId: 'repo-1',
  repo: 'orca',
  path: 'mobile-list',
  hasAttachedPty: true,
  isPinned: false,
  branch: 'feature/mobile-list',
  displayName: 'mobile-list',
  liveTerminalCount: 1,
  unread: false,
  linkedPR: null,
  agents: [agent()],
  status: 'active',
  lastOutputAt: 1_000
}

describe('memoized worktree rows', () => {
  let renderer: ReactTestRenderer | null = null

  beforeEach(() => {
    agentSpinnerRender.mockClear()
    agentStateDotRender.mockClear()
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('skips an unrelated parent render but updates for live item fields and time', async () => {
    await act(async () => {
      renderer = create(createElement(ListRowHarness, { item: baseItem, now: 2_000 }))
    })
    expect(agentSpinnerRender).toHaveBeenCalledTimes(1)

    await act(async () => updateSibling((value) => value + 1))
    expect(agentSpinnerRender).toHaveBeenCalledTimes(1)

    let expectedRenders = 1
    const liveUpdates: TestItem[] = [
      { ...baseItem, unread: true },
      { ...baseItem, lastOutputAt: 2_000 },
      { ...baseItem, agents: [agent({ state: 'waiting', updatedAt: 2_000 })] },
      { ...baseItem, status: 'working' }
    ]
    for (const liveUpdate of liveUpdates) {
      await act(async () =>
        renderer!.update(createElement(ListRowHarness, { item: liveUpdate, now: 2_000 }))
      )
      expect(agentSpinnerRender).toHaveBeenCalledTimes(++expectedRenders)
      await act(async () =>
        renderer!.update(createElement(ListRowHarness, { item: baseItem, now: 2_000 }))
      )
      expect(agentSpinnerRender).toHaveBeenCalledTimes(++expectedRenders)
    }

    await act(async () =>
      renderer!.update(createElement(ListRowHarness, { item: baseItem, now: 32_000 }))
    )
    expect(agentSpinnerRender).toHaveBeenCalledTimes(++expectedRenders)
  })

  it('skips a value-equal item and re-renders for time, callbacks and nested agent fields', async () => {
    const onPress = () => undefined
    const row = (item: TestItem, overrides: { now?: number; onPress?: () => void } = {}) =>
      createElement(WorktreeListRow, {
        item,
        isReadOnly: false,
        now: overrides.now ?? 2_000,
        repoColor: '#000000',
        repoIcon: { type: 'emoji', emoji: 'o' },
        status: item.status,
        onPress: overrides.onPress ?? onPress
      })
    await act(async () => {
      renderer = create(row(baseItem))
    })
    expect(agentSpinnerRender).toHaveBeenCalledTimes(1)

    // A fresh parse of the same row, with a fresh repo icon object, is not a change.
    await act(async () => renderer!.update(row(structuredClone(baseItem))))
    expect(agentSpinnerRender).toHaveBeenCalledTimes(1)

    await act(async () => renderer!.update(row(baseItem, { now: 32_000 })))
    expect(agentSpinnerRender).toHaveBeenCalledTimes(2)

    const nestedChange = structuredClone(baseItem)
    nestedChange.agents![0]!.lastAssistantMessage = 'Tests pass'
    await act(async () => renderer!.update(row(nestedChange, { now: 32_000 })))
    expect(agentSpinnerRender).toHaveBeenCalledTimes(3)

    await act(async () =>
      renderer!.update(row(nestedChange, { now: 32_000, onPress: () => undefined }))
    )
    expect(agentSpinnerRender).toHaveBeenCalledTimes(4)
  })

  it('memoizes agent rows without hiding agent updates', async () => {
    const firstAgent = agent()
    await act(async () => {
      renderer = create(
        createElement(WorktreeAgentRow, {
          agent: firstAgent,
          depth: 0,
          now: 2_000,
          unvisited: false
        })
      )
    })
    expect(agentStateDotRender).toHaveBeenCalledTimes(1)

    await act(async () => {
      renderer!.update(
        createElement(WorktreeAgentRow, {
          agent: firstAgent,
          depth: 0,
          now: 2_000,
          unvisited: false
        })
      )
    })
    expect(agentStateDotRender).toHaveBeenCalledTimes(1)

    await act(async () => {
      renderer!.update(
        createElement(WorktreeAgentRow, {
          agent: agent({ state: 'working', workingMode: 'monitoring', updatedAt: 2_000 }),
          depth: 0,
          now: 2_000,
          unvisited: false
        })
      )
    })
    expect(agentStateDotRender).toHaveBeenCalledTimes(2)
    expect(agentStateDotRender).toHaveBeenLastCalledWith({ state: 'monitoring' })
  })

  it('passes workspace monitoring mode to the status indicator', async () => {
    await act(async () => {
      renderer = create(
        createElement(ListRowHarness, {
          item: { ...baseItem, status: 'working', workingMode: 'monitoring' },
          now: 2_000
        })
      )
    })

    expect(agentSpinnerRender).toHaveBeenLastCalledWith({
      status: 'working',
      workingMode: 'monitoring'
    })
  })

  it('names the host with a glyph that matches the host kind', async () => {
    const textNodes = (): string[] =>
      renderer!.root
        .findAllByType('Text' as never)
        .flatMap((node) => node.props.children)
        .filter((child): child is string => typeof child === 'string')

    await act(async () => {
      renderer = create(
        createElement(ListRowHarness, {
          item: { ...baseItem, hostId: 'ssh:ssh-1', hostContextLabel: 'openclaw' },
          now: 2_000
        })
      )
    })
    expect(textNodes()).toContain('openclaw')
    expect(textNodes().some((text) => text.includes('Disconnected'))).toBe(false)
    expect(renderer!.root.findAllByType('Server' as never)).toHaveLength(1)

    await act(async () =>
      renderer!.update(
        createElement(ListRowHarness, {
          item: {
            ...baseItem,
            hostId: 'ssh:ssh-1',
            hostContextLabel: 'openclaw',
            hostContextHealthLabel: 'Disconnected'
          },
          now: 2_000
        })
      )
    )
    // Separate nodes: the name truncates while the health word stays whole.
    expect(textNodes()).toEqual(expect.arrayContaining(['openclaw', '· Disconnected']))
    const healthText = renderer!.root
      .findAllByType('Text' as never)
      .find((node) => node.props.children === '· Disconnected')
    expect([healthText?.props.style].flat()).toContainEqual({ flexShrink: 0 })
    const announcedBadges = renderer!.root.findAll(
      (node) => node.props.accessibilityLabel === 'openclaw, Disconnected'
    )
    expect(announcedBadges).toHaveLength(1)
    expect(renderer!.root.findAllByType('Monitor' as never)).toHaveLength(0)

    await act(async () =>
      renderer!.update(
        createElement(ListRowHarness, {
          item: { ...baseItem, hostContextLabel: 'Local Mac' },
          now: 2_000
        })
      )
    )
    expect(textNodes()).toContain('Local Mac')
    expect(renderer!.root.findAllByType('Monitor' as never)).toHaveLength(1)

    await act(async () =>
      renderer!.update(createElement(ListRowHarness, { item: baseItem, now: 2_000 }))
    )
    expect(textNodes()).not.toContain('Local Mac')
    expect(renderer!.root.findAllByType('Monitor' as never)).toHaveLength(0)
  })
})
