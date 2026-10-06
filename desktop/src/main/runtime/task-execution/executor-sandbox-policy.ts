import type { AgyExecApplied } from '../../agy-exec/agy-exec-types'
import type { CodexExecApplied, CodexExecSandbox } from '../../codex-exec/codex-exec-types'
import type { WORKFLOW_RUN_ACCESS_LEVELS } from '../orchestration/db/autopilot-run-schema-definition'

// D-025: the CLI's own sandbox follows the run's access level. A write run gets each CLI's normal
// write mode and nothing beyond it: no full-access sandbox, no permission bypass, no edit auto-accept.

export type RunAccess = (typeof WORKFLOW_RUN_ACCESS_LEVELS)[number]

/** The sandbox a run asked for and the one its runner applied, both in access-level words. */
export type ExecutorSandboxCheck = {
  readonly requested: RunAccess
  /** Null when the runner applied no sandbox the access levels name, or refused the request. */
  readonly applied: RunAccess | null
}

const CODEX_SANDBOX_BY_ACCESS: Readonly<Record<RunAccess, CodexExecSandbox>> = {
  read_only: 'read-only',
  workspace_write: 'workspace-write'
}

export function codexSandboxForAccess(access: RunAccess): CodexExecSandbox {
  return CODEX_SANDBOX_BY_ACCESS[access]
}

/** agy has no read-only flag; `--sandbox` restricts its terminal, so only a read-only run keeps it. */
export function agySandboxForAccess(access: RunAccess): boolean {
  return access === 'read_only'
}

/** The access a Codex run went out with; no `--sandbox` is not one the executors ask for, so it is null. */
export function codexAppliedAccess(
  applied: Pick<CodexExecApplied, 'sandbox'> | null
): RunAccess | null {
  switch (applied?.sandbox) {
    case 'read-only':
      return 'read_only'
    case 'workspace-write':
      return 'workspace_write'
    default:
      return null
  }
}

/** The access an agy run went out with, read from whether the argv it used carried `--sandbox`. */
export function agyAppliedAccess(result: {
  readonly applied: AgyExecApplied | null
  readonly argv: readonly string[]
}): RunAccess | null {
  if (result.applied === null) {
    return null
  }
  return result.argv.includes('--sandbox') ? 'read_only' : 'workspace_write'
}
