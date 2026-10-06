import { describe, expect, it, vi } from 'vitest'
import { HOOK_REQUEST_MAX_BYTES } from '../../shared/agent-hook-listener/request-body'
import { encodeClaudeStatusLineRelayRequest } from '../../shared/claude-statusline-relay-contract'
import { RELAY_STDIN_MAX_BYTES, runClaudeStatusLineRelay, type RelayRunPorts } from './relay-run'

const SHELL = 'C:\\Program Files\\Git\\bin\\bash.exe'
const INPUT = '{"rate_limits":{"five_hour":{"used_percentage":1}}}'
const OUTPUT = Buffer.from('[Opus] 1%\n')

function harness(overrides: Partial<RelayRunPorts> = {}) {
  const written: Buffer[] = []
  const ports: RelayRunPorts = {
    argv: [encodeClaudeStatusLineRelayRequest({ shell: SHELL, command: 'hud' })],
    readStdin: vi.fn(async () => INPUT),
    writeStdout: (bytes) => {
      written.push(bytes)
    },
    forward: vi.fn(async () => 'posted'),
    runUser: vi.fn(async () => OUTPUT),
    ...overrides
  }
  return { ports, written }
}

describe('runClaudeStatusLineRelay', () => {
  it('forwards the payload, runs the user command with the same stdin and prints its output', async () => {
    const { ports, written } = harness()
    await runClaudeStatusLineRelay(ports)
    expect(ports.readStdin).toHaveBeenCalledWith(RELAY_STDIN_MAX_BYTES)
    expect(ports.forward).toHaveBeenCalledWith(INPUT)
    expect(ports.runUser).toHaveBeenCalledWith({ shell: SHELL, command: 'hud' }, INPUT)
    expect(written).toEqual([OUTPUT])
  })

  it('still prints the user status line when the forward fails', async () => {
    const { ports, written } = harness({
      forward: vi.fn(async () => {
        throw new Error('hook server down')
      })
    })
    await expect(runClaudeStatusLineRelay(ports)).resolves.toBeUndefined()
    expect(written).toEqual([OUTPUT])
  })

  it('still forwards when the user command fails, and prints nothing', async () => {
    const { ports, written } = harness({ runUser: vi.fn(async () => null) })
    await runClaudeStatusLineRelay(ports)
    expect(ports.forward).toHaveBeenCalledWith(INPUT)
    expect(written).toEqual([])
  })

  it('swallows a throwing user command runner', async () => {
    const { ports, written } = harness({
      runUser: vi.fn(async () => {
        throw new Error('unexpected')
      })
    })
    await expect(runClaudeStatusLineRelay(ports)).resolves.toBeUndefined()
    expect(written).toEqual([])
  })

  it('still forwards but runs no command when the relay argument is missing or damaged', async () => {
    for (const argv of [[], ['%%%']]) {
      const { ports, written } = harness({ argv })
      await runClaudeStatusLineRelay(ports)
      expect(ports.forward).toHaveBeenCalledWith(INPUT)
      expect(ports.runUser).not.toHaveBeenCalled()
      expect(written).toEqual([])
    }
  })

  it("caps stdin at the hook listener's own body limit", () => {
    expect(RELAY_STDIN_MAX_BYTES).toBe(HOOK_REQUEST_MAX_BYTES)
  })

  it('does nothing when stdin is unreadable or over the cap', async () => {
    const { ports, written } = harness({ readStdin: vi.fn(async () => null) })
    await runClaudeStatusLineRelay(ports)
    expect(ports.forward).not.toHaveBeenCalled()
    expect(ports.runUser).not.toHaveBeenCalled()
    expect(written).toEqual([])
  })

  it('prints nothing for empty user output', async () => {
    const { ports, written } = harness({ runUser: vi.fn(async () => Buffer.alloc(0)) })
    await runClaudeStatusLineRelay(ports)
    expect(written).toEqual([])
  })
})
