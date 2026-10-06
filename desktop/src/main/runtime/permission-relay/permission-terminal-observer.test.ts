import { describe, expect, it, vi } from 'vitest'
import type { RuntimeTerminalAgentStatus } from '../../../shared/runtime-types'
import {
  PERMISSION_OBSERVER_MAX_UNKNOWN_READS,
  PermissionTerminalObserver,
  readAgentDialogState,
  type AgentStatusReader
} from './permission-terminal-observer'

type Status = RuntimeTerminalAgentStatus['status']

function statusReader(initial: Record<string, Status | 'gone' | 'not_agent'>) {
  const current = { ...initial }
  const read = vi.fn<AgentStatusReader>(async (handle) => {
    const value = current[handle]
    if (value === undefined || value === 'gone') {
      throw new Error('terminal_gone')
    }
    if (value === 'not_agent') {
      return { handle, isRunningAgent: false, status: null }
    }
    return { handle, isRunningAgent: true, status: value }
  })
  return {
    read,
    set: (handle: string, value: Status | 'gone' | 'not_agent') => (current[handle] = value)
  }
}

function harness(initial: Record<string, Status | 'gone' | 'not_agent'>) {
  const statuses = statusReader(initial)
  const pending = new Set<string>()
  const answered: string[] = []
  const observer = new PermissionTerminalObserver({
    readStatus: statuses.read,
    sink: {
      isPending: (id) => pending.has(id),
      markAnsweredInTerminal: (id) => {
        pending.delete(id)
        answered.push(id)
      }
    }
  })
  const open = (id: string, handle: string) => {
    pending.add(id)
    observer.watch(id, handle)
  }
  return { observer, statuses, pending, answered, open }
}

describe('readAgentDialogState (the D-019 dialog read for C3)', () => {
  it('reads open only while the agent shows a permission or question dialog', async () => {
    const { read, set } = statusReader({ t1: 'permission' })
    await expect(readAgentDialogState(read, 't1')).resolves.toBe('open')
    set('t1', 'working')
    await expect(readAgentDialogState(read, 't1')).resolves.toBe('closed')
    set('t1', 'idle')
    await expect(readAgentDialogState(read, 't1')).resolves.toBe('closed')
    set('t1', null)
    await expect(readAgentDialogState(read, 't1')).resolves.toBe('closed')
  })

  it('reads unknown when the terminal is gone or no agent runs there', async () => {
    const { read, set } = statusReader({ t1: 'gone' })
    await expect(readAgentDialogState(read, 't1')).resolves.toBe('unknown')
    set('t1', 'not_agent')
    await expect(readAgentDialogState(read, 't1')).resolves.toBe('unknown')
  })
})

describe('permission terminal observer', () => {
  it('closes a prompt as answered in the terminal once its dialog was seen and then left', async () => {
    const { observer, statuses, answered, open } = harness({ t1: 'permission' })
    open('d1', 't1')
    await observer.poll()
    expect(observer.holds('d1')).toBe(true)
    statuses.set('t1', 'working')
    await observer.poll()
    expect(answered).toEqual(['d1'])
    expect(observer.size).toBe(0)
    expect(observer.holds('d1')).toBe(false)
  })

  it('does not close a prompt whose dialog it never saw', async () => {
    const { observer, answered, open } = harness({ t1: 'working' })
    open('d1', 't1')
    await observer.poll()
    await observer.poll()
    expect(answered).toEqual([])
    expect(observer.size).toBe(1)
    expect(observer.holds('d1')).toBe(false)
  })

  it('stops watching a prompt dot or the desktop already answered, without marking it', async () => {
    const { observer, statuses, pending, answered, open } = harness({ t1: 'permission' })
    open('d1', 't1')
    await observer.poll()
    pending.delete('d1')
    statuses.set('t1', 'working')
    await observer.poll()
    expect(answered).toEqual([])
    expect(observer.size).toBe(0)
  })

  it('lets go of a pane it cannot read, so the expiry sweep closes the prompt instead', async () => {
    const { observer, answered, open } = harness({ t1: 'gone' })
    open('d1', 't1')
    for (let read = 0; read < PERMISSION_OBSERVER_MAX_UNKNOWN_READS - 1; read += 1) {
      await observer.poll()
      expect(observer.size).toBe(1)
    }
    await observer.poll()
    expect(observer.size).toBe(0)
    expect(answered).toEqual([])
  })

  it('reads each pane once per poll and closes every armed prompt on it', async () => {
    const { observer, statuses, answered, open } = harness({ t1: 'permission', t2: 'permission' })
    open('d1', 't1')
    open('d2', 't1')
    open('d3', 't2')
    await observer.poll()
    expect(statuses.read).toHaveBeenCalledTimes(2)
    statuses.set('t1', 'idle')
    await observer.poll()
    expect(answered.sort()).toEqual(['d1', 'd2'])
    expect(observer.holds('d3')).toBe(true)
  })
})
