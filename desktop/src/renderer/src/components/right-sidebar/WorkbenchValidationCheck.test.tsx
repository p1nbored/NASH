// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type * as RpcResult from '@/runtime/runtime-rpc-result'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkbenchValidationCheck from './WorkbenchValidationCheck'

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn<(target: unknown, method: string, params?: unknown) => Promise<unknown>>()
}))

vi.mock('@/runtime/runtime-rpc-client', async () => {
  const result = await vi.importActual<typeof RpcResult>('@/runtime/runtime-rpc-result')
  return { callRuntimeRpc: rpc, RuntimeRpcCallError: result.RuntimeRpcCallError }
})
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key: string) => String(values?.[key] ?? '')),
  getIntlLocale: () => 'en-US'
}))

const COUNTS = { checked: 4, passed: 2, failed: 1, inconclusive: 1, skipped: 0 }

function refusal(code: string, message: string): RuntimeRpcCallError {
  return new RuntimeRpcCallError({ id: 'call', ok: false, error: { code, message } })
}

function checkButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Check now' })
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  rpc.mockReset().mockResolvedValue(COUNTS)
})
afterEach(() => cleanup())

describe('WorkbenchValidationCheck', () => {
  it('says briefly what Check now adds, without internal terms, and checks nothing until asked', () => {
    render(<WorkbenchValidationCheck />)
    const section = screen.getByRole('region', { name: 'Task validation' })
    expect(section.textContent).toContain(
      'Each result is checked when its task reports. Check now also checks results still waiting.'
    )
    expect(section.textContent).not.toContain('TaskSpec')
    expect(checkButton()).toBeDefined()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('runs one pass on click, holds the button while it runs, then shows the counts', async () => {
    let answer: (value: unknown) => void = () => undefined
    rpc.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    render(<WorkbenchValidationCheck />)
    fireEvent.click(checkButton())
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      { kind: 'local' },
      'workbench.validation.checkPending',
      {}
    )
    expect(checkButton().hasAttribute('disabled')).toBe(true)
    expect(checkButton().getAttribute('aria-busy')).toBe('true')
    fireEvent.click(checkButton())
    expect(rpc).toHaveBeenCalledTimes(1)

    answer(COUNTS)
    await settle()
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Results checked: 4')
    expect(within(status).getByText('Passed').nextElementSibling?.textContent).toBe('2')
    expect(within(status).getByText('Failed').nextElementSibling?.textContent).toBe('1')
    expect(within(status).getByText('Left for a decision').nextElementSibling?.textContent).toBe(
      '1'
    )
    expect(within(status).getByText('Skipped').nextElementSibling?.textContent).toBe('0')
    expect(checkButton().hasAttribute('disabled')).toBe(false)
  })

  it('says so when nothing was waiting', async () => {
    rpc.mockResolvedValueOnce({ checked: 0, passed: 0, failed: 0, inconclusive: 0, skipped: 0 })
    render(<WorkbenchValidationCheck />)
    fireEvent.click(checkButton())
    await settle()
    expect(screen.getByRole('status').textContent).toBe(
      'No task results were waiting for validation.'
    )
  })

  it('explains a refusal because a pass is already running, with its code in details only', async () => {
    rpc.mockRejectedValueOnce(
      refusal('workbench_validation_pass_running', 'A pass is running (server text).')
    )
    render(<WorkbenchValidationCheck />)
    fireEvent.click(checkButton())
    await settle()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Validation not checked')
    expect(alert.textContent).toContain(
      'A validation pass is already running. Check again when it finishes.'
    )
    expect(alert.textContent).not.toContain('workbench_validation_pass_running')
    expect(within(alert).getByRole('button', { name: 'Copy details' })).toBeDefined()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('explains that validation is not available in this session', async () => {
    rpc.mockRejectedValueOnce(refusal('workbench_validation_unavailable', 'Server text.'))
    render(<WorkbenchValidationCheck />)
    fireEvent.click(checkButton())
    await settle()
    expect(screen.getByRole('alert').textContent).toContain(
      'Task validation is not available in this session.'
    )
  })

  it('treats counts that do not add up as an invalid response', async () => {
    rpc.mockResolvedValueOnce({ ...COUNTS, checked: 9 })
    render(<WorkbenchValidationCheck />)
    fireEvent.click(checkButton())
    await settle()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('The app returned an unexpected response.')
    expect(alert.textContent).not.toContain('invalid_response')
  })

  it('clears an earlier refusal when the next check succeeds', async () => {
    rpc.mockRejectedValueOnce(refusal('workbench_validation_pass_running', 'Server text.'))
    render(<WorkbenchValidationCheck />)
    fireEvent.click(checkButton())
    await settle()
    expect(screen.getByRole('alert')).toBeDefined()
    fireEvent.click(checkButton())
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Results checked: 4')
  })
})
