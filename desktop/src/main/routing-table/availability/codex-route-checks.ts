import { CodexExecutableError, type CodexExecutable } from '../../codex-exec/codex-exec-executable'
import type { WorkspaceLaunchKind } from '../../../shared/workspace-launch-kind'
import { commonEfforts } from './listed-model-match'
import type { CheckOutcome, RouteSubject } from './route-availability-types'
import { authQuotaChecksOf } from './route-auth-quota-checks'
import type {
  CodexExecutableReading,
  RouteCheckResult,
  RouteObservations
} from './route-check-observations'
import { cliCheckOf } from './route-cli-detection-check'
import { mapCodexEffort, reasoningCheckOf } from './route-effort-mapping'
import { checkModel } from './route-model-check'

/** How `resolveCodexExecutable` would launch codex, or why it cannot; the path itself is not kept. */
export function readCodexExecutable(resolve: () => CodexExecutable): CodexExecutableReading {
  try {
    const executable = resolve()
    return { ok: true, launch: executable.launch, source: executable.source }
  } catch (error) {
    return { ok: false, code: error instanceof CodexExecutableError ? error.code : 'unexpected' }
  }
}

/** Detection first, then the launch target the runner would use: both must hold. */
function cliOutcome(observations: RouteObservations): CheckOutcome {
  const detected = cliCheckOf(observations.detection, 'codex')
  const executable = observations.codexExecutable
  if (detected.result !== 'pass') {
    return detected
  }
  if (executable.ok) {
    return {
      check: 'cli',
      result: 'pass',
      evidence: { agent: 'codex', launch: executable.launch, source: executable.source }
    }
  }
  return {
    check: 'cli',
    result: 'fail',
    reason: executable.code === 'not_found' ? 'cli_missing' : 'cli_not_launchable',
    evidence: { agent: 'codex', resolution: executable.code }
  }
}

/**
 * A folder workspace runs with codex's git-repository check skipped (D-027); the floating terminal
 * has no directory for codex to work in.
 */
function workspaceOutcome(workspaceKind: WorkspaceLaunchKind | null): CheckOutcome | null {
  switch (workspaceKind) {
    case null:
      return null
    case 'git-worktree':
      return { check: 'workspace', result: 'pass', evidence: { workspaceKind } }
    case 'folder':
      return {
        check: 'workspace',
        result: 'pass',
        evidence: { workspaceKind, gitRepoCheck: 'skipped' }
      }
    case 'floating':
      return {
        check: 'workspace',
        result: 'fail',
        reason: 'workspace_not_git',
        evidence: { workspaceKind }
      }
  }
}

/** Codex routes use the account model list and pass its resolved effort to the native launcher. */
export function checkCodexRoute(
  subject: RouteSubject,
  observations: RouteObservations
): RouteCheckResult {
  const model = checkModel(subject.model, observations.listing, {
    matchResolvedModel: false
  })
  const mapping =
    model.rows === null
      ? null
      : mapCodexEffort({
          level: subject.reasoningLevel,
          listedEfforts: commonEfforts(model.rows)
        })
  const workspace = workspaceOutcome(observations.workspaceKind)
  return {
    checks: [
      cliOutcome(observations),
      model.outcome,
      ...(mapping === null ? [] : [reasoningCheckOf(mapping)]),
      ...authQuotaChecksOf('codex', observations),
      ...(workspace === null ? [] : [workspace])
    ],
    mapping
  }
}
