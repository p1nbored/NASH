// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type * as ReactModule from 'react'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAttemptTranscriptCache } from './use-attempt-transcript'
import TaskWindowPanel from './TaskWindowPanel'
import {
  attempt,
  codexStart,
  everyKindTranscript,
  readResult,
  rec,
  resetFixtureSeq,
  windowState
} from './task-window.test-fixture'

const { rpc, store } = vi.hoisted(() => {
  const worktreesByRepo: Record<string, { id: string; path: string }[]> = {}
  return {
    rpc: vi.fn<
      (target: unknown, method: string, params?: Record<string, unknown>) => Promise<unknown>
    >(),
    store: {
      selectTaskWindowAttempt: vi.fn(),
      patchTaskWindowAttempts: vi.fn(),
      worktreesByRepo
    }
  }
})

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const result = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: result.RuntimeRpcCallError }
})
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (state: typeof store) => unknown) => selector(store), {
    getState: () => store
  })
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key: string) => String(values?.[key] ?? '')),
  getIntlLocale: () => 'en-US'
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))
vi.mock('../ui/select', async () => {
  const React = await vi.importActual<typeof ReactModule>('react')
  const Ctx = React.createContext<(value: string) => void>(() => {})
  return {
    Select: ({
      onValueChange,
      children
    }: {
      onValueChange: (v: string) => void
      children: React.ReactNode
    }) => <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>,
    SelectTrigger: ({ children, ...props }: React.ComponentProps<'button'>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const choose = React.useContext(Ctx)
      return (
        <button type="button" role="option" aria-selected={false} onClick={() => choose(value)}>
          {children}
        </button>
      )
    }
  }
})

type Reply = (params: Record<string, unknown>) => unknown

function serve(transcript: Reply, tasks: Reply = () => ({ tasks: [] })): void {
  rpc.mockImplementation(async (_target, method, params) => {
    if (method === 'workbench.attempts.transcript.read') {
      return transcript(params ?? {})
    }
    if (method === 'workbench.runs.tasks') {
      return tasks(params ?? {})
    }
    throw new Error(`unexpected ${method}`)
  })
}

function readCalls(): Record<string, unknown>[] {
  return rpc.mock.calls
    .filter((call) => call[1] === 'workbench.attempts.transcript.read')
    .map((call) => call[2] ?? {})
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  rpc.mockReset()
  store.selectTaskWindowAttempt.mockReset()
  store.patchTaskWindowAttempts.mockReset()
  resetAttemptTranscriptCache()
  resetFixtureSeq()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TaskWindowPanel', () => {
  it('shows every record kind of a Codex transcript under a header', async () => {
    const transcript = everyKindTranscript()
    serve(() => readResult(transcript, 0, { live: false, ended: true }))
    render(<TaskWindowPanel fileId="tab-1" state={windowState()} />)
    await flush()

    expect(screen.getByRole('heading', { name: 'Codex · Review the parser' })).toBeDefined()
    expect(screen.getByText('gpt-6.1-sol')).toBeDefined()
    expect(screen.getByText('Read only')).toBeDefined()
    const log = screen.getByRole('log', { name: 'Transcript' })
    expect(within(log).getByText('pnpm test receipt')).toBeDefined()
    expect(within(log).getByText('The parser rejects receipts without a signature.')).toBeDefined()
    expect(within(log).getByText('contracts/receipt.ts')).toBeDefined()
    expect(within(log).getByText('Web search · Completed')).toBeDefined()
    expect(within(log).getByText(/1,200 input · 300 cached · 450 output tokens/)).toBeDefined()
    expect(within(log).getByText('FIXTURE_ONLY deprecation warning')).toBeDefined()
    expect(within(log).getByText('Reconnecting to the model.')).toBeDefined()
    expect(within(log).getByText(/4 records were dropped/)).toBeDefined()
    expect(within(log).getByText('A record this version cannot show.')).toBeDefined()
    expect(log.textContent).not.toContain('reasoning_digest')
    expect(within(log).getByText('Unreadable line')).toBeDefined()
    expect(within(log).getByText(/Ended · Completed · exit code 0/)).toBeDefined()
    expect(within(log).queryByText('never shown')).toBeNull()
  })

  it('shows the branch of a writing attempt and keeps IDs and the base commit for Copy details', async () => {
    const write = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { ui: { writeClipboardText: write } }
    })
    const start = rec('start', {
      executor: 'codex',
      model: 'gpt-6.1-sol',
      effort: 'high',
      sandbox: 'write',
      cwd: 'C:/fixture/worktrees/nash-task-1',
      worktree: {
        branch: 'nash-task-1',
        path: 'C:/fixture/worktrees/nash-task-1',
        baseCommit: '0123456789abcdef0123456789abcdef01234567'
      }
    })
    const end = rec('end', { state: 'failed', exitCode: 1, reasonCode: 'nonzero_exit' })
    serve(() => readResult(start + end, 0, { live: false, ended: true }))
    try {
      render(<TaskWindowPanel fileId="tab-1" state={windowState()} />)
      await flush()
      const header = screen.getByRole('banner')
      expect(within(header).getByText('nash-task-1')).toBeDefined()
      expect(within(header).getByText('Writes in its own worktree')).toBeDefined()
      const chip = within(header).getByText('Failed').closest('[data-kind]')
      expect(chip?.getAttribute('data-kind')).toBe('failed')
      expect(document.body.textContent).not.toContain('0123456789ab')
      expect(document.body.textContent).not.toContain('nonzero_exit')
      expect(document.body.textContent).not.toContain('ctx_fixture01')
      await act(async () => {
        fireEvent.click(within(header).getByRole('button', { name: 'Copy details' }))
      })
      const copied = write.mock.calls.at(-1)?.[0] ?? ''
      expect(copied.split('\n')).toEqual(
        expect.arrayContaining([
          'NASH Workbench: task window',
          'attempt_id: ctx_fixture01',
          'base_commit: 0123456789abcdef0123456789abcdef01234567',
          'worktree_path: C:/fixture/worktrees/nash-task-1',
          'end_reason: nonzero_exit',
          'exit_code: 1'
        ])
      )
    } finally {
      Reflect.deleteProperty(window, 'api')
    }
  })

  it('words a refused transcript read without its code and stops reading', async () => {
    const { RuntimeRpcCallError } = await vi.importActual<typeof RpcResult>(
      '@/runtime/runtime-rpc-result'
    )
    rpc.mockImplementation(async (_target, method) => {
      if (method === 'workbench.runs.tasks') {
        return { tasks: [] }
      }
      throw new RuntimeRpcCallError({
        id: 'r',
        ok: false,
        error: {
          code: 'workbench_transcript_refused',
          message: 'The transcript could not be confirmed as this attempt’s own file.'
        }
      })
    })
    render(<TaskWindowPanel fileId="tab-1" state={windowState()} />)
    await flush()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('The transcript file could not be verified, so it was not read.')
    expect(within(alert).getByRole('button', { name: 'Copy details' })).toBeDefined()
    await flush(10_000)
    expect(readCalls()).toHaveLength(1)
  })

  it('keeps command output collapsed until asked', async () => {
    serve(() => readResult(everyKindTranscript(), 0, { live: false, ended: true }))
    render(<TaskWindowPanel fileId="tab-1" state={windowState()} />)
    await flush()

    expect(screen.queryByText('FIXTURE_ONLY 12 tests passed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show output of pnpm test receipt' }))
    expect(screen.getByText('FIXTURE_ONLY 12 tests passed')).toBeDefined()
  })

  it('reads once a second while live and stops after the end record', async () => {
    const start = codexStart()
    const message = rec('message', { text: 'Working.' })
    const end = rec('end', { state: 'completed', exitCode: 0, reasonCode: null })
    const replies = [
      readResult(start, 0),
      readResult(message, start.length),
      readResult(end, start.length + message.length, { live: false, ended: true })
    ]
    serve((params) => replies.shift() ?? readResult('', Number(params.fromByteOffset)))
    render(<TaskWindowPanel fileId="tab-1" state={windowState()} />)
    await flush()
    expect(readCalls()).toHaveLength(1)
    await flush(1000)
    expect(screen.getByText('Working.')).toBeDefined()
    await flush(1000)
    expect(readCalls().map((call) => call.fromByteOffset)).toEqual([
      0,
      start.length,
      start.length + message.length
    ])
    expect(readCalls()[0]).toEqual({
      dispatchId: 'ctx_fixture01',
      fromByteOffset: 0,
      maxBytes: 262_144
    })
    await flush(10_000)
    expect(readCalls()).toHaveLength(3)
  })

  it('stops reading when the tab unmounts', async () => {
    serve((params) => readResult('', Number(params.fromByteOffset)))
    const view = render(<TaskWindowPanel fileId="tab-1" state={windowState()} />)
    await flush(2000)
    const before = readCalls().length
    view.unmount()
    await flush(10_000)
    expect(readCalls()).toHaveLength(before)
  })

  it('follows the newest output until the user scrolls up, then offers Jump to latest', async () => {
    let next = codexStart()
    let offset = 0
    serve(() => {
      const reply = readResult(next, offset)
      offset += next.length
      next = ''
      return reply
    })
    render(<TaskWindowPanel fileId="tab-1" state={windowState()} />)
    await flush()
    const log = screen.getByRole('log', { name: 'Transcript' })
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 200 })

    next = rec('message', { text: 'First.' })
    await flush(1000)
    expect(log.scrollTop).toBe(1000)

    log.scrollTop = 100
    fireEvent.scroll(log)
    next = rec('message', { text: 'Second.' })
    await flush(1000)
    expect(screen.getByText('Second.')).toBeDefined()
    expect(log.scrollTop).toBe(100)

    fireEvent.click(screen.getByRole('button', { name: 'Jump to latest' }))
    expect(log.scrollTop).toBe(1000)
    expect(screen.queryByRole('button', { name: 'Jump to latest' })).toBeNull()
  })

  it('says when a live transcript has no output yet, is empty, or was never recorded', async () => {
    serve(() => readResult('', 0))
    const live = render(<TaskWindowPanel fileId="tab-1" state={windowState()} />)
    await flush()
    expect(screen.getByText('Waiting for the first output…')).toBeDefined()
    live.unmount()

    resetAttemptTranscriptCache()
    serve(() => readResult('', 0, { live: false }))
    const empty = render(<TaskWindowPanel fileId="tab-1" state={windowState()} />)
    await flush(5000)
    expect(screen.getByText('The transcript is empty.')).toBeDefined()
    empty.unmount()

    resetAttemptTranscriptCache()
    rpc.mockReset()
    const { RuntimeRpcCallError } = await vi.importActual<typeof RpcResult>(
      '@/runtime/runtime-rpc-result'
    )
    rpc.mockImplementation(async () => {
      throw new RuntimeRpcCallError({
        id: 'r',
        ok: false,
        error: {
          code: 'workbench_transcript_missing',
          message: 'No transcript was recorded for this attempt.'
        }
      })
    })
    render(<TaskWindowPanel fileId="tab-1" state={windowState()} />)
    await flush()
    expect(screen.getByText('No transcript was recorded for this attempt.')).toBeDefined()
    await flush(10_000)
    expect(readCalls()).toHaveLength(1)
  })

  it('shows agy output as plain lines under an agy title', async () => {
    const transcript = [
      rec('start', {
        executor: 'agy',
        model: 'gemini-3.8-flash-high',
        effort: null,
        sandbox: 'read-only',
        cwd: 'C:/x',
        worktree: null
      }),
      rec('output', { stream: 'stdout', text: 'FIXTURE_ONLY Reading 14 files' }),
      rec('output', { stream: 'stdout', text: 'FIXTURE_ONLY Summary written' })
    ].join('')
    serve(() => readResult(transcript, 0))
    render(
      <TaskWindowPanel
        fileId="tab-2"
        state={windowState({ executorKind: 'agy', title: 'Summarize the tests' })}
      />
    )
    await flush()
    expect(screen.getByRole('heading', { name: 'agy · Summarize the tests' })).toBeDefined()
    expect(screen.getByText('FIXTURE_ONLY Reading 14 files')).toBeDefined()
    expect(screen.getByText('Default')).toBeDefined()
  })

  it('lets the user pick an earlier attempt of the task', async () => {
    serve((params) => readResult('', Number(params.fromByteOffset)))
    const state = windowState({
      attempts: [
        attempt('ctx_fixture00', { state: 'failed', settledAt: '2026-10-05T18:01:00.000Z' }),
        attempt('ctx_fixture01')
      ]
    })
    render(<TaskWindowPanel fileId="tab-1" state={state} />)
    await flush()
    fireEvent.click(screen.getByRole('option', { name: /Attempt 1 · Failed/ }))
    expect(store.selectTaskWindowAttempt).toHaveBeenCalledWith('tab-1', 'ctx_fixture00')
  })
})
