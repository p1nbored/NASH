import { win32 } from 'node:path'
import type { ExecutableEvidence } from '../../agent-exec-shared/executable-evidence'
import type { LaunchTarget } from '../../agent-exec-shared/launch-target'
import type { TreeProof } from '../../agent-exec-shared/tree-termination'
import type { JsonObject } from '../orchestration/db/autopilot-json-column'
import type { LatchKind } from '../../routing-table/availability/route-availability-types'
import { placementEvidence, type AttemptPlacement } from './attempt-workspace'
import type {
  ExecutorFacts,
  ExecutorRunCancellation,
  ExecutorRunVerdict
} from './executor-run-report'
import type {
  ProcessAttemptPlan,
  ProcessLaunchPorts,
  TaskExecutorKind
} from './process-executor-contract'

// The launch inputs both executors resolve before an attempt is marked running, and the parts of a
// runner result both keep. A refusal is a reason code, so no error text (paths, env) is recorded.

export type ResolvedLaunch<T extends LaunchTarget> = {
  readonly executable: T
  readonly worktreePath: string
  readonly runsRoot: string
  readonly parentEnv: NodeJS.ProcessEnv | undefined
}

export type LaunchResolution<T extends LaunchTarget> =
  | { readonly ok: true; readonly launch: ResolvedLaunch<T> }
  | { readonly ok: false; readonly reason: string }

const ERROR_CODE = /^[a-z][a-z0-9_]{0,40}$/

function executableReason(error: unknown): string {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null
  return code !== null && ERROR_CODE.test(code) ? `executable_${code}` : 'executable_unresolved'
}

function attempt<T>(read: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: read() }
  } catch {
    return { ok: false }
  }
}

async function attemptAsync<T>(
  read: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await read() }
  } catch {
    return { ok: false }
  }
}

export async function resolveLaunch<T extends LaunchTarget>(
  ports: ProcessLaunchPorts,
  resolveExecutable: () => T,
  plan: ProcessAttemptPlan
): Promise<LaunchResolution<T>> {
  let executable: T
  try {
    executable = resolveExecutable()
  } catch (error) {
    return { ok: false, reason: executableReason(error) }
  }
  const worktree = attempt(() => ports.workspacePath(plan.workspaceId))
  if (!worktree.ok) {
    return { ok: false, reason: 'workspace_unavailable' }
  }
  const runsRoot = await attemptAsync(() => ports.runsRoot(plan.runId))
  if (!runsRoot.ok) {
    return { ok: false, reason: 'runs_root_unavailable' }
  }
  const env = await attemptAsync(async () => ports.parentEnv?.())
  if (!env.ok) {
    return { ok: false, reason: 'environment_unavailable' }
  }
  return {
    ok: true,
    launch: {
      executable,
      worktreePath: worktree.value,
      runsRoot: runsRoot.value,
      parentEnv: env.value
    }
  }
}

/**
 * What the executor row records at launch: the launch shape and the entry file's name (never its
 * path), and where the attempt runs, which validation reads back to look where the task wrote.
 */
export function launchEvidence(
  kind: TaskExecutorKind,
  executable: LaunchTarget & { readonly source?: string },
  placement: AttemptPlacement
): JsonObject {
  return {
    executor: kind,
    launch: executable.launch,
    ...(executable.source === undefined ? {} : { source: executable.source }),
    // Why: win32 parsing accepts both separators, so the name is right for either platform's path.
    entryFile: win32.basename(executable.entryPath),
    ...placementEvidence(placement)
  }
}

export function cancellationOf(
  cancellation:
    | { readonly requested: false }
    | ({ readonly requested: true; readonly trigger: 'abort_signal' | 'timeout' } & TreeProof)
): ExecutorRunCancellation {
  return cancellation.requested
    ? {
        requested: true,
        trigger: cancellation.trigger,
        proof: { verdict: cancellation.verdict, method: cancellation.method }
      }
    : { requested: false }
}

/** The binary facts kept beside a verdict; the version text is already redacted and bounded by the runner. */
export function executableFacts(
  evidence: ExecutableEvidence | null,
  durationMs: number
): ExecutorFacts {
  return {
    durationMs,
    version: evidence?.version ?? null,
    versionProbe: evidence?.versionProbe ?? null
  }
}

type RunnerFailure = { readonly kind: string }

/** The verdict shape both runners share; only the failure kinds are kept, never their detail text. */
export type RunnerVerdict =
  | { readonly status: 'completed' }
  | { readonly status: 'failed'; readonly failures: readonly [RunnerFailure, ...RunnerFailure[]] }
  | {
      readonly status: 'blocked'
      readonly reason: LatchKind
      readonly failures: readonly RunnerFailure[]
    }

export function runnerVerdict(verdict: RunnerVerdict): ExecutorRunVerdict {
  switch (verdict.status) {
    case 'completed':
      return { status: 'completed' }
    case 'failed': {
      const [first, ...rest] = verdict.failures
      return {
        status: 'failed',
        failureKinds: [first.kind, ...rest.map((failure) => failure.kind)]
      }
    }
    case 'blocked':
      return {
        status: 'blocked',
        reason: verdict.reason,
        failureKinds: verdict.failures.map((failure) => failure.kind)
      }
  }
}
