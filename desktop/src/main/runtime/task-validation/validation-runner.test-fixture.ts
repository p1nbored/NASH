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
import type { TaskRouteInput } from '../orchestration/db/task-route-store'
import type { TaskSpecInput } from '../orchestration/db/task-spec-store'
import { createAttemptReader } from './attempt-evidence'
import type { ReviewerRequest, ReviewerRunOutcome } from './reviewer-runner'
import {
  createTaskValidationPort,
  createValidationDecisionPort,
  type TaskValidationPort
} from './task-validation-port'
import { createValidationRunner } from './validation-runner'
import type { WorkspaceGitStatus } from './workspace-write-check'

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
  mkdirSync(workspace)
  writeFileSync(join(workspace, 'report.md'), 'Report body.')
  const state: WorldState = {
    workspaceKind: 'git',
    git: { ok: true, changedFiles: [], headCommitSeconds: 1 },
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
      resolveWorkspace: async () => ({ path: workspace, kind: state.workspaceKind })
    }),
    git: { readStatus: async () => state.git },
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

  /** An in-session attempt claimed with a report and waiting for validation. */
  function claimedTask(
    options: {
      spec?: Partial<TaskSpecInput>
      deps?: string[]
      route?: Partial<TaskRouteInput>
    } = {}
  ) {
    return inSessionClaim({ ...options, report: RESULT_TEXT })
  }

  /** An in-session attempt the primary claimed through task-report; `report` is the notice body. */
  function inSessionClaim(
    options: {
      spec?: Partial<TaskSpecInput>
      report?: string
      deps?: string[]
      route?: Partial<TaskRouteInput>
    } = {}
  ) {
    const seeded = seedRoutedTask(harness, {
      spec: options.spec,
      deps: options.deps,
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
    taskStatus: (taskId: string) => harness.owner.getTask(taskId)?.status,
    cleanup: () => {
      harness.owner.close()
      rmSync(base, { recursive: true, force: true })
    }
  }
}
