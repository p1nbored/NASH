import { join } from 'node:path'
import {
  CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS,
  CLAUDE_STATUSLINE_PATHNAME
} from '../../shared/claude-statusline-rate-limits'

export type RelayForwardPost = {
  readonly port: number
  readonly path: string
  readonly token: string
  /** application/x-www-form-urlencoded, the shape Orca's statusline script posts. */
  readonly body: string
}

export type RelayForwardPorts = {
  readonly env: NodeJS.ProcessEnv
  readonly tempDir: string
  nowSeconds(): number
  /** A bounded text read; null when the file is missing, unreadable or too large. */
  readText(path: string): string | null
  /** Best effort: a stamp that cannot be written only means the next tick may post again. */
  writeText(path: string, text: string): void
  post(request: RelayForwardPost): Promise<void>
}

export type RelayForwardOutcome =
  | 'posted'
  | 'failed'
  | 'skipped_job'
  | 'skipped_no_pane'
  | 'skipped_no_rate_limits'
  | 'skipped_throttled'
  | 'skipped_no_endpoint'

type HookEndpoint = {
  readonly port: number
  readonly token: string
  readonly env: string
  readonly version: string
}

const ENDPOINT_LINE = /^(?:set\s+)?(ORCA_AGENT_HOOK_(?:PORT|TOKEN|ENV|VERSION))=(.*)$/
const CANONICAL_SECONDS = /^(?:0|[1-9][0-9]{0,14})$/

/**
 * Orca's statusline relay, minus everything but the usage windows: the same gates (a pane, no
 * background job worker), the same 15-second per-pane throttle and the same endpoint, token and
 * form fields, so G4's `/statusline/claude` ingest accepts it unchanged.
 */
export async function forwardClaudeRateLimits(
  payloadText: string,
  ports: RelayForwardPorts
): Promise<RelayForwardOutcome> {
  const { env } = ports
  // Why: a backgrounded session's status line runs in a daemon worker that inherited another pane's env.
  if (env.CLAUDE_JOB_DIR) {
    return 'skipped_job'
  }
  const paneKey = env.ORCA_PANE_KEY ?? ''
  if (paneKey === '') {
    return 'skipped_no_pane'
  }
  const rateLimits = readRateLimits(payloadText)
  if (rateLimits === null) {
    return 'skipped_no_rate_limits'
  }
  const stampPath = join(ports.tempDir, `orca-claude-statusline-last-${paneStampId(paneKey)}.tmp`)
  const now = ports.nowSeconds()
  if (isThrottled(ports.readText(stampPath), now)) {
    return 'skipped_throttled'
  }
  const endpoint = resolveHookEndpoint(env, ports.readText)
  if (endpoint === null) {
    return 'skipped_no_endpoint'
  }
  // Why stamp only now: a skipped tick must never push the next allowed post out.
  ports.writeText(stampPath, String(now))
  const body = new URLSearchParams({
    paneKey,
    configDir: env.CLAUDE_CONFIG_DIR ?? '',
    env: endpoint.env,
    version: endpoint.version,
    payload: JSON.stringify({ rate_limits: rateLimits })
  }).toString()
  try {
    await ports.post({
      port: endpoint.port,
      path: CLAUDE_STATUSLINE_PATHNAME,
      token: endpoint.token,
      body
    })
    return 'posted'
  } catch {
    return 'failed'
  }
}

function readRateLimits(payloadText: string): object | null {
  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null || !('rate_limits' in payload)) {
    return null
  }
  const rateLimits = payload.rate_limits
  return typeof rateLimits === 'object' && rateLimits !== null && !Array.isArray(rateLimits)
    ? rateLimits
    : null
}

/** The key's stable tail, made filename-safe so it can never leave the temp folder. */
function paneStampId(paneKey: string): string {
  return paneKey.slice(-36).replace(/[^A-Za-z0-9._-]/g, '_')
}

function isThrottled(stamp: string | null, now: number): boolean {
  const last = stamp?.trim() ?? ''
  if (!CANONICAL_SECONDS.test(last)) {
    return false
  }
  const elapsed = now - Number(last)
  return elapsed >= 0 && elapsed < CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS
}

/** The endpoint file is read as text and never run: on Windows it is a `.cmd` file. */
function resolveHookEndpoint(
  env: NodeJS.ProcessEnv,
  readText: RelayForwardPorts['readText']
): HookEndpoint | null {
  const fromFile = new Map<string, string>()
  const endpointPath = env.ORCA_AGENT_HOOK_ENDPOINT
  const text = endpointPath ? readText(endpointPath) : null
  for (const line of text?.split(/\r?\n/) ?? []) {
    const match = ENDPOINT_LINE.exec(line.trim())
    if (match) {
      fromFile.set(match[1], match[2])
    }
  }
  const read = (key: string): string => fromFile.get(key) || env[key] || ''
  const port = Number(read('ORCA_AGENT_HOOK_PORT'))
  const token = read('ORCA_AGENT_HOOK_TOKEN')
  if (!Number.isInteger(port) || port < 1 || port > 65_535 || token === '') {
    return null
  }
  return {
    port,
    token,
    env: read('ORCA_AGENT_HOOK_ENV'),
    version: read('ORCA_AGENT_HOOK_VERSION')
  }
}
