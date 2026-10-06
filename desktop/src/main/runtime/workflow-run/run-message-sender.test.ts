import { describe, expect, it } from 'vitest'
import type { RuntimeAgentPromptWriteOptions } from '../runtime-terminal-contracts'
import { sendRunMessageToPrimary } from './run-message-sender'
import { FIXTURE_HANDLE, createFakeTerminal } from './primary-session.test-fixture'

type Script = (options: RuntimeAgentPromptWriteOptions) => Promise<void>

function terminalWith(script: Script) {
  const { terminal } = createFakeTerminal()
  terminal.sendTerminalAgentPrompt.mockImplementation(async (handle, prompt, options) => {
    await script(options)
    return { handle, accepted: true, bytesWritten: prompt.length + 1 }
  })
  return terminal
}

describe('sending a run message into the primary terminal', () => {
  it("uses Orca's prompt writer as a driving prompt that may queue", async () => {
    const { terminal } = createFakeTerminal()
    await expect(
      sendRunMessageToPrimary(terminal, FIXTURE_HANDLE, 'Check the README.', 'request-1')
    ).resolves.toEqual({ kind: 'sent' })
    expect(terminal.sendTerminalAgentPrompt).toHaveBeenCalledWith(
      FIXTURE_HANDLE,
      'Check the README.',
      expect.objectContaining({
        inputKind: 'driving',
        acceptQueued: true,
        requestId: 'request-1',
        observationTimeoutMs: 0
      })
    )
  })

  it('reports an open dialog found before any write as dialog_blocked', async () => {
    const terminal = terminalWith(async () => {
      throw new Error('agent_prompt_blocked')
    })
    await expect(sendRunMessageToPrimary(terminal, FIXTURE_HANDLE, 'Hi.', 'r')).resolves.toEqual({
      kind: 'dialog_blocked'
    })
  })

  it('reports a dialog that opened before the paste as dialog_blocked', async () => {
    const terminal = terminalWith(async (options) => {
      await options.beforeWrite?.('pty')
      throw new Error('agent_prompt_blocked')
    })
    await expect(sendRunMessageToPrimary(terminal, FIXTURE_HANDLE, 'Hi.', 'r')).resolves.toEqual({
      kind: 'dialog_blocked'
    })
  })

  it('reports a dialog that opened between paste and Enter as incomplete', async () => {
    const terminal = terminalWith(async (options) => {
      await options.beforeWrite?.('pty')
      await options.beforeWrite?.('pty')
      throw new Error('agent_prompt_blocked')
    })
    await expect(sendRunMessageToPrimary(terminal, FIXTURE_HANDLE, 'Hi.', 'r')).resolves.toEqual({
      kind: 'incomplete'
    })
  })

  it('reports a failure after the paste as incomplete, because the text may sit unsent', async () => {
    const terminal = terminalWith(async (options) => {
      await options.beforeWrite?.('pty')
      throw new Error('terminal_handle_stale')
    })
    await expect(sendRunMessageToPrimary(terminal, FIXTURE_HANDLE, 'Hi.', 'r')).resolves.toEqual({
      kind: 'incomplete'
    })
  })

  it('reports an unwritable terminal before any byte as not_written with its code', async () => {
    const terminal = terminalWith(async () => {
      throw new Error('terminal_not_writable')
    })
    await expect(sendRunMessageToPrimary(terminal, FIXTURE_HANDLE, 'Hi.', 'r')).resolves.toEqual({
      kind: 'not_written',
      code: 'terminal_not_writable'
    })
  })

  it('reports a failed paste write as not_written', async () => {
    const terminal = terminalWith(async (options) => {
      await options.beforeWrite?.('pty')
      throw new Error('terminal_not_writable')
    })
    await expect(sendRunMessageToPrimary(terminal, FIXTURE_HANDLE, 'Hi.', 'r')).resolves.toEqual({
      kind: 'not_written',
      code: 'terminal_not_writable'
    })
  })

  it('counts a failure after Enter was accepted as sent', async () => {
    const terminal = terminalWith(async (options) => {
      await options.beforeWrite?.('pty')
      await options.beforeWrite?.('pty')
      options.onInputAccepted?.({ handle: FIXTURE_HANDLE, accepted: true, bytesWritten: 4 })
      throw new Error('agent_prompt_stalled')
    })
    await expect(sendRunMessageToPrimary(terminal, FIXTURE_HANDLE, 'Hi.', 'r')).resolves.toEqual({
      kind: 'sent'
    })
  })

  it('never copies free error text into the result', async () => {
    const terminal = terminalWith(async () => {
      throw new Error('token=abc123 leaked in a message')
    })
    await expect(sendRunMessageToPrimary(terminal, FIXTURE_HANDLE, 'Hi.', 'r')).resolves.toEqual({
      kind: 'not_written',
      code: 'unexpected_error'
    })
  })

  it('treats a refused receipt as not written', async () => {
    const { terminal } = createFakeTerminal()
    terminal.sendTerminalAgentPrompt.mockResolvedValueOnce({
      handle: FIXTURE_HANDLE,
      accepted: false,
      bytesWritten: 0
    })
    await expect(sendRunMessageToPrimary(terminal, FIXTURE_HANDLE, 'Hi.', 'r')).resolves.toEqual({
      kind: 'not_written',
      code: 'prompt_not_accepted'
    })
  })
})
