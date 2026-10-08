import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson } from '../../../shared/canonical-json'
import { PERMISSION_HOOK_TIMEOUT_SECONDS } from '../../../shared/workflow-run/autopilot-cli-commands'
import { readHooksJsonWithRaw } from '../../agent-hooks/hooks-json-read'
import { resolveCodexCommand } from '../../codex-cli/command'
import { CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS } from '../../codex-cli/codex-read-only-app-server-args'
import { collectListedHooks, type CodexListedHook } from '../../codex/codex-app-server-client'
import {
  isCodexAppServerUnsupportedError,
  runCodexAppServerSession,
  type CodexAppServerInvocation
} from '../../codex/codex-app-server-session'
import {
  getCodexExplicitHomeHookSourcePath,
  normalizeHookTrustKeyForLookup
} from '../../codex/config-toml-trust'
import { getPermissionHookCommand } from './permission-hook-command'
import { readCodexStateDbBackfillPendingState } from '../../codex/codex-state-db'

type FailureReason =
  | 'gate_missing'
  | 'gate_changed'
  | 'hook_not_listed'
  | 'hash_mismatch'
  | 'disabled'
  | 'verification_failed'
  | 'unsupported'
  | 'cli_unavailable'
  | 'provider_busy'
export type CodexPermissionTrustResult =
  | { status: 'trusted' }
  | { status: 'native_approval_required'; reason: FailureReason }

const SESSION_TIMEOUT_MS = 30_000
const required = (reason: FailureReason): CodexPermissionTrustResult => ({
  status: 'native_approval_required',
  reason
})

function ownedDefinition(command: string) {
  return {
    matcher: '*',
    hooks: [{ type: 'command', command, timeout: PERMISSION_HOOK_TIMEOUT_SECONDS }]
  }
}

function listedGate(
  raw: unknown,
  sourcePath: string,
  groupIndex: number,
  command: string
): CodexListedHook | null {
  const expectedKey = normalizeHookTrustKeyForLookup(
    `${sourcePath}:permission_request:${groupIndex}:0`
  )
  const matches = collectListedHooks(raw).filter(
    (entry) =>
      entry.command === command && normalizeHookTrustKeyForLookup(entry.key) === expectedKey
  )
  return matches.length === 1 ? matches[0] : null
}

function invocation(command: string, home: string): CodexAppServerInvocation {
  return {
    command,
    cliPath: command,
    args: [...CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS],
    env: { CODEX_HOME: home },
    timeoutMs: SESSION_TIMEOUT_MS
  }
}

/** Trust only this app's installed permission gate, using Codex's hash of our isolated definition. */
export async function approveCodexPermissionHook(
  home = homedir()
): Promise<CodexPermissionTrustResult> {
  let scratch: string | null = null
  try {
    const codexHome = join(home, '.codex')
    const hooksPath = join(codexHome, 'hooks.json')
    const command = getPermissionHookCommand('codex', home)
    const definition = ownedDefinition(command)
    const before = readHooksJsonWithRaw(hooksPath)
    const groups = before.config?.hooks?.PermissionRequest
    if (!Array.isArray(groups) || before.raw === null) {
      return required('gate_missing')
    }
    const owned = groups.flatMap((group, index) =>
      canonicalJson(group) === canonicalJson(definition) ? [index] : []
    )
    if (owned.length !== 1) {
      return required('gate_missing')
    }
    // A short-lived provider process can refresh an unfinished backfill lease.
    if (readCodexStateDbBackfillPendingState(codexHome) !== 'not-pending') {
      return required('provider_busy')
    }
    const sourcePath = getCodexExplicitHomeHookSourcePath(hooksPath)
    const unchanged = (): boolean =>
      readHooksJsonWithRaw(hooksPath).raw === before.raw &&
      getCodexExplicitHomeHookSourcePath(hooksPath) === sourcePath
    const codex = resolveCodexCommand()
    scratch = await mkdtemp(join(tmpdir(), 'nash-codex-permission-trust-'))
    await writeFile(
      join(scratch, 'hooks.json'),
      JSON.stringify({ hooks: { PermissionRequest: [definition] } })
    )
    const scratchPath = getCodexExplicitHomeHookSourcePath(join(scratch, 'hooks.json'))
    const cwd = scratch
    const expected = await runCodexAppServerSession(invocation(codex, scratch), async (rpc) =>
      listedGate(await rpc.request('hooks/list', { cwds: [cwd] }), scratchPath, 0, command)
    )
    if (!expected) {
      return required('hook_not_listed')
    }
    if (!unchanged()) {
      return required('gate_changed')
    }
    if (readCodexStateDbBackfillPendingState(codexHome) !== 'not-pending') {
      return required('provider_busy')
    }
    return await runCodexAppServerSession(
      invocation(codex, codexHome),
      async (rpc): Promise<CodexPermissionTrustResult> => {
        const read = async (): Promise<CodexListedHook | null> =>
          listedGate(
            await rpc.request('hooks/list', { cwds: [cwd] }),
            sourcePath,
            owned[0],
            command
          )
        const listed = await read()
        if (!unchanged()) {
          return required('gate_changed')
        }
        if (!listed) {
          return required('hook_not_listed')
        }
        if (listed.enabled === false) {
          return required('disabled')
        }
        if (listed.currentHash !== expected.currentHash) {
          return required('hash_mismatch')
        }
        // Older Codex lists supported hooks without an approval mechanism.
        if (listed.currentHash === null) {
          return listed.trustStatus === null
            ? { status: 'trusted' }
            : required('verification_failed')
        }
        if (listed.trustStatus !== 'trusted') {
          await rpc.request('config/batchWrite', {
            edits: [
              {
                keyPath: 'hooks.state',
                value: { [listed.key]: { trusted_hash: listed.currentHash } },
                mergeStrategy: 'upsert'
              }
            ],
            reloadUserConfig: true
          })
        }
        const verified = await read()
        if (!unchanged()) {
          return required('gate_changed')
        }
        return verified?.currentHash === expected.currentHash &&
          verified.trustStatus === 'trusted' &&
          verified.enabled !== false
          ? { status: 'trusted' }
          : required('verification_failed')
      }
    )
  } catch (error) {
    return required(isCodexAppServerUnsupportedError(error) ? 'unsupported' : 'cli_unavailable')
  } finally {
    if (scratch !== null) {
      await rm(scratch, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
    }
  }
}
