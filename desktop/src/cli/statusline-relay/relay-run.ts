import {
  decodeClaudeStatusLineRelayRequest,
  type ClaudeStatusLineRelayRequest
} from '../../shared/claude-statusline-relay-contract'

/**
 * The hook listener's body cap (`HOOK_REQUEST_MAX_BYTES`, pinned equal by a test) without loading
 * the listener module on every render; a status-line JSON is a few kilobytes.
 */
export const RELAY_STDIN_MAX_BYTES = 1_000_000

export type RelayRunPorts = {
  readonly argv: readonly string[]
  /** The whole of stdin as text, or null when it is unreadable or larger than `maxBytes`. */
  readStdin(maxBytes: number): Promise<string | null>
  writeStdout(bytes: Buffer): void
  forward(payload: string): Promise<unknown>
  runUser(request: ClaudeStatusLineRelayRequest, input: string): Promise<Buffer | null>
}

/**
 * One status-line render: forward the usage windows to NASH and run the user's own status line on
 * the same stdin, side by side, then print only what the user's command printed. Never throws, so
 * Claude Code always sees exit 0 and, at worst, an empty status line.
 */
export async function runClaudeStatusLineRelay(ports: RelayRunPorts): Promise<void> {
  const input = await ports.readStdin(RELAY_STDIN_MAX_BYTES).catch(() => null)
  if (input === null) {
    return
  }
  const request = decodeClaudeStatusLineRelayRequest(ports.argv[0])
  const [, output] = await Promise.all([
    ports.forward(input).catch(() => undefined),
    request ? ports.runUser(request, input).catch(() => null) : Promise.resolve(null)
  ])
  if (output && output.length > 0) {
    ports.writeStdout(output)
  }
}
