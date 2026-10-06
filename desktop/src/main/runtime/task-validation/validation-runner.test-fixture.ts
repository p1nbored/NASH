// FIXTURE_ONLY: every id, hash, path and model below is synthetic and describes no real run.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RouteAvailabilityResult } from '../../routing-table/availability/route-availability-types'
import type { ReviewerResolution } from '../../routing-table/route-resolver'
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import type { JsonObject } from '../orchestration/db/autopilot-json-column'
import type { TaskRouteInput } from '../orchestration/db/task-route-store'
import type { TaskSpecInput } from '../orchestration/db/task-spec-store'
import type { AttemptWorktree } from '../task-execution/attempt-worktree'
import type { WorktreeChangeFacts } from '../task-execution/task-result-notice'
import { createAttemptReader } from './attempt-evidence'
import type { ReviewerRequest, ReviewerRunOutcome } from './reviewer-runner'
import {
  createTaskValidationPort,
  createValidationDecisionPort,
  type TaskValidationPort
} from './task-validation-port'
import { sha256Of } from './task-validation.test-fixture'
import { createValidationRunner } from './validation-runner'
import type { WorkspaceGitStatus } from './workspace-write-check'

const EXITED = { verdict: 'exited', method: 'windows_descendant_snapshot' } as const
const SUBAGENT_ROUTE = {
  target: 'claude_subagent',
  model: 'claude-sonnet-5-5',
  policyLevel: 'max',
  cliSetting: null
} as const
export const RESULT_TEXT = 'Done.'

export function reviewerResolution(
  status: 'available' | 'unverified',
  model = 'claude-opus-5-5'
): ReviewerResolution {
  const subject = {
    target: 'claude_headless',
    model,
    reasoningLevel: 'high',
    requirement: 'required',
    inheritsCoordinator: false
  } as const
  const snapshot = {
    checkedAtMs: 0,
    freshness: 'dispatch',
    workspaceKind: null,
    checks: [],
    observedAtMs: { detection: 0, models: 0, rateLimits: 0 }
  } as const
  const availability: RouteAvailabilityResult =
    status === 'available'
      ? {
          subject,
          snapshot,
          status,
          reasons: [],
          cli: {
            target: 'claude_headless',
            model,
            effort: 'high',
            effortDelivery: 'claude_effort_flag',
            requestedLevel: 'high',
            requirement: 'required',
            resolution: 'applied'
          }
        }
      : { subject, snapshot, status, reasons: ['auth_unobserved'], cli: null }
  return {
    ok: true,
    table: { version: 1, sha256: 'c'.repeat(64) },
    reviewer: { target: 'claude_headless', model, reasoning_level: 'high' },
    availability
  }
}

export type RunnerWorld = ReturnType<typeof createRunnerWorld>

type WorldState = {
  workspaceKind: 'git' | 'folder'
  git: WorkspaceGitStatus
  /** What the fake git shows in an attempt's own worktree, and each worktree it was asked about. */
  worktreeChanges: WorktreeChangeFacts
  worktreeReads: AttemptWorktree[]
  resolution: ReviewerResolution
  reviewOutcome: ReviewerRunOutcome
  reviewRequests: ReviewerRequest[]
  reviewThrows: boolean
  latched: string[]
  resolverCalls: number
}

/** A memory database, a real temp workspace and run directory, and fakes for git, the table and reviewers. */
export function createRunnerWorld(
  options: { wrapPort?: (port: TaskValidationPort) => TaskValidationPort } = {}
) {
  const harness: AppRunHarness = createAppRunHarness()
  const base = mkdtempSync(join(tmpdir(), 'c5-runner-'))
  const workspace = join(base, 'workspace')
  const appData = join(base, 'app-data')
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'report.md'), 'Report body.')
  const state: WorldState = {
    workspaceKind: 'git',
    git: { ok: true, changedFiles: [], headCommitSeconds: 1 },
    worktreeChanges: { readable: true, commitsAhead: 1, uncommitted: false },
    worktreeReads: [],
    resolution: reviewerResolution('available'),
    reviewOutcome: { status: 'failed', reason: 'not_scripted' },
    reviewRequests: [],
    reviewThrows: false,
    latched: [],
    resolverCalls: 0
  }
  const port = createTaskValidationPort(harness.owner)
  const reviewer = async (request: ReviewerRequest): Promise<ReviewerRunOutcome> => {
    state.reviewRequests.push(request)
    if (state.reviewThrows) {
      throw new Error('fixture reviewer crashed')
    }
    return state.reviewOutcome
  }
  let clock = Date.parse(fixtureTime(20))
  const runner = createValidationRunner({
    port: options.wrapPort ? options.wrapPort(port) : port,
    reader: createAttemptReader(harness.owner, {
      resolveWorkspace: async () => ({ path: workspace, kind: state.workspaceKind }),
      resolveRunDirectory: (relative) => join(appData, relative)
    }),
    git: { readStatus: async () => state.git },
    readWorktreeChanges: async (worktree) => {
      state.worktreeReads.push(worktree)
      return state.worktreeChanges
    },
    review: {
      resolver: {
        resolveValidationReviewer: async () => {
          state.resolverCalls += 1
          return state.resolution
        },
        latch: (subject) => state.latched.push(subject.model)
      },
      runners: { codex_cli: reviewer, claude_headless: reviewer }
    },
    now: () => new Date((clock += 1000))
  })

  const runDirOf = (dispatchId: string): string =>
    join(appData, 'autopilot-runs', harness.runId, dispatchId)

  /** A Codex attempt of a new task, claimed and waiting for validation, with its result on disk. */
  function claimedTask(
    options: {
      spec?: Partial<TaskSpecInput>
      deps?: string[]
      route?: Partial<TaskRouteInput>
      executableEvidence?: JsonObject
    } = {}
  ) {
    const seeded = seedRoutedTask(harness, options)
    const settlement = getAppAttemptSettlement(harness.owner)
    const { dispatchId } = settlement.start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'codex_cli',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    const runDir = runDirOf(dispatchId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'last-message.txt'), RESULT_TEXT)
    settlement.markRunning({
      dispatchId,
      executableEvidence: options.executableEvidence ?? { executable: 'codex' },
      timestamp: fixtureTime(6)
    })
    settlement.settleClaim({
      dispatchId,
      exitCode: 0,
      tree: EXITED,
      lastMessage: { sha256: sha256Of(RESULT_TEXT), bytes: 5, secretLike: false },
      verdict: { status: 'completed' },
      timestamp: fixtureTime(7)
    })
    return { ...seeded, dispatchId }
  }

  /** An in-session attempt the primary claimed through task-report; `report` is the notice body. */
  function inSessionClaim(
    options: {
      spec?: Partial<TaskSpecInput>
      report?: string
      route?: Partial<TaskRouteInput>
    } = {}
  ) {
    const seeded = seedRoutedTask(harness, {
      spec: options.spec,
      route: options.route ?? SUBAGENT_ROUTE
    })
    const settlement = getAppAttemptSettlement(harness.owner)
    const { dispatchId } = settlement.start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor: 'in_session',
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    settlement.markRunning({ dispatchId, timestamp: fixtureTime(6) })
    settlement.settleClaim({
      dispatchId,
      ...(options.report === undefined
        ? {}
        : { notice: { subject: 'Task claimed', body: options.report } }),
      timestamp: fixtureTime(7)
    })
    return { ...seeded, dispatchId }
  }

  return {
    harness,
    port,
    decisions: createValidationDecisionPort(harness.owner),
    runner,
    state,
    workspace,
    claimedTask,
    inSessionClaim,
    resultPath: (dispatchId: string) => join(runDirOf(dispatchId), 'last-message.txt'),
    taskStatus: (taskId: string) => harness.owner.getTask(taskId)?.status,
    cleanup: () => {
      harness.owner.close()
      rmSync(base, { recursive: true, force: true })
    }
  }
}
