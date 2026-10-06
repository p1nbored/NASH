import { describe, expect, it, vi } from 'vitest'

// Why: capture the human formatter; printResult only writes output.
vi.mock('../../format', () => ({ printResult: vi.fn() }))

import { hasDisplayControls } from '../../../shared/display-control-characters'
import { printResult } from '../../format'
import { ORCHESTRATION_TASK_HANDLERS } from './task-handlers'

const ESC = String.fromCodePoint(0x1b)

type ListResult = {
  tasks: {
    id: string
    spec: string
    task_title?: string | null
    display_name?: string | null
    status: string
    spec_truncated?: boolean
  }[]
  count: number
}

async function humanTaskList(result: ListResult): Promise<string> {
  vi.mocked(printResult).mockClear()
  const call = vi.fn().mockResolvedValue({ id: 'call', ok: true, result })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only flags, client.call and json here.
  await ORCHESTRATION_TASK_HANDLERS['orchestration task-list']({
    flags: new Map<string, string | boolean>([['run', 'run_fixture01']]),
    client: { call },
    cwd: '/fixture',
    json: false
  } as never)
  const [response, , formatter] = vi.mocked(printResult).mock.calls[0] ?? []
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: printResult was called with the list response and its formatter.
  return (formatter as (value: ListResult) => string)((response as { result: ListResult }).result)
}

describe('orchestration task-list human output', () => {
  it.each([
    ['title', { task_title: 'Fix\u202Egnp.exe\u0007probe' }, 'Fix gnp.exe probe'],
    ['display name', { display_name: 'Run\u2028now\u2066x' }, 'Run now x'],
    ['spec', {}, 'Line one\u001B[2J two']
  ] as const)(
    'prints a task %s with terminal, line-separator and bidi controls as spaces',
    async (_label, fields, expected) => {
      const printed = await humanTaskList({
        tasks: [
          {
            id: 'task_1',
            spec: 'Line one\u001B[2J two',
            status: 'ready',
            spec_truncated: false,
            ...fields
          }
        ],
        count: 1
      })
      expect(printed).toBe(`task_1 [ready] ${expected.replaceAll(ESC, ' ')}`)
      expect(hasDisplayControls(printed)).toBe(false)
    }
  )
})
