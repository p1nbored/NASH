import { createHash } from 'node:crypto'
import type { CommandHandler, HandlerContext } from '../../dispatch'
import { RuntimeClientError } from '../../runtime/types'
import {
  PERMISSION_RELAY_WAIT_MS,
  PERMISSION_WAIT_SLICE_MAX_MS,
  PermissionRequestResultSchema,
  PermissionWaitResultSchema,
  type PermissionHookOutput
} from '../../../shared/rpc-contract/permission-relay-params'
import { PERMISSION_HOOK_TIMEOUT_SECONDS } from '../../../shared/workflow-run/autopilot-cli-commands'
import { parsePermissionHookInput } from './permission-hook-input'

/** One RPC call returning the method's result; it throws on a transport or method failure. */
export type PermissionHookRpc = (
  method: string,
  params: unknown,
  timeoutMs: number
) => Promise<unknown>

export type PermissionHookIo = {
  stdin: AsyncIterable<Uint8Array | string>
  writeStdout(text: string): void
  writeStderr(text: string): void
  now(): number
  sleep(ms: number): Promise<void>
}

const STDIN_MAX_BYTES = 16 * 1024 * 1024
/** Claude Code cancels the hook at its timeout; this command is done this long before that. */
const EXIT_MARGIN_MS = 15_000
const CALL_GRACE_MS = 5_000
const CREATE_TIMEOUT_MS = 10_000
const MIN_SLICE_MS = 1_000
const MAX_WAIT_FAILURES = 2
const RETRY_DELAY_MS = 500
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/

async function readHookStdin(
  stdin: AsyncIterable<Uint8Array | string>
): Promise<{ text: string | null; sha256: string }> {
  const hash = createHash('sha256')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stdin) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)
    hash.update(bytes)
    size += bytes.length
    if (size <= STDIN_MAX_BYTES) {
      chunks.push(bytes)
    }
  }
  const text = size <= STDIN_MAX_BYTES ? Buffer.concat(chunks).toString('utf8') : null
  return { text, sha256: hash.digest('hex') }
}

async function waitForDecision(
  rpc: PermissionHookRpc,
  io: PermissionHookIo,
  decisionId: string,
  exitBy: number
): Promise<PermissionHookOutput | null> {
  let failures = 0
  for (;;) {
    const remaining = exitBy - io.now()
    if (remaining < CALL_GRACE_MS + MIN_SLICE_MS) {
      return null
    }
    const waitMs = Math.min(PERMISSION_WAIT_SLICE_MAX_MS, remaining - CALL_GRACE_MS)
    let reply: unknown
    try {
      reply = await rpc(
        'orchestration.permissionWait',
        { decisionId, waitMs },
        waitMs + CALL_GRACE_MS
      )
    } catch (error) {
      failures += 1
      if (failures > MAX_WAIT_FAILURES) {
        throw error
      }
      await io.sleep(RETRY_DELAY_MS)
      continue
    }
    failures = 0
    const result = PermissionWaitResultSchema.parse(reply)
    if (result.state === 'decided') {
      return result.hookOutput
    }
    if (result.state === 'no_decision') {
      return null
    }
  }
}

async function relayPermissionRequest(
  rpc: PermissionHookRpc,
  io: PermissionHookIo,
  exitBy: number
): Promise<PermissionHookOutput | null> {
  const stdin = await readHookStdin(io.stdin)
  // Why: the server's deadline must fall before this process gives up, or an answer could win unseen.
  const budget = Math.min(PERMISSION_RELAY_WAIT_MS, exitBy - io.now() - CALL_GRACE_MS)
  const params =
    stdin.text === null ? null : parsePermissionHookInput(stdin.text, stdin.sha256, budget)
  if (!params) {
    return null
  }
  const created = PermissionRequestResultSchema.parse(
    await rpc('orchestration.permissionRequest', params, CREATE_TIMEOUT_MS)
  )
  return created.outcome === 'relayed' ? waitForDecision(rpc, io, created.decisionId, exitBy) : null
}

function errorCode(error: unknown): string {
  return error instanceof RuntimeClientError && ERROR_CODE.test(error.code)
    ? error.code
    : 'unexpected'
}

/**
 * The PermissionRequest hook command. It prints the documented decision JSON only for an answer
 * from dot or the desktop, and prints nothing otherwise, so Claude Code's own dialog decides. It
 * always exits 0: a failure never allows or denies anything, and stderr carries only an error code.
 */
export async function runPermissionRequestHook(
  rpc: PermissionHookRpc,
  io: PermissionHookIo
): Promise<void> {
  const exitBy = io.now() + PERMISSION_HOOK_TIMEOUT_SECONDS * 1000 - EXIT_MARGIN_MS
  try {
    const output = await relayPermissionRequest(rpc, io, exitBy)
    if (output) {
      io.writeStdout(`${JSON.stringify(output)}\n`)
    }
  } catch (error) {
    io.writeStderr(
      `Permission relay unavailable (${errorCode(error)}); the prompt stays in the terminal.\n`
    )
  }
}

async function* noInput(): AsyncIterable<string> {}

function processHookIo(): PermissionHookIo {
  return {
    // Why: run by hand from a terminal there is no hook JSON, so do not wait for one.
    stdin: process.stdin.isTTY ? noInput() : process.stdin,
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  }
}

function clientRpc(context: HandlerContext): PermissionHookRpc {
  // Why `context.client` inside the call: creating the client can throw, and that must stay a no-decision.
  return async (method, params, timeoutMs) =>
    (await context.client.call<unknown>(method, params, { timeoutMs })).result
}

export const ORCHESTRATION_PERMISSION_HANDLERS: Record<string, CommandHandler> = {
  'orchestration permission-request': (context) =>
    runPermissionRequestHook(clientRpc(context), processHookIo())
}
