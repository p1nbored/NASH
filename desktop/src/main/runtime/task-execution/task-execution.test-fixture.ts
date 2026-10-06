// FIXTURE_ONLY: every id, model, path and result below is synthetic; no CLI, model or credential is used.
import type { ExecutionTarget } from '../../../shared/routing-table/routing-table-taxonomy'
import type {
  RouteAvailabilityResult,
  RouteSubject,
  UnavailableReason
} from '../../routing-table/availability/route-availability-types'
import type { MessageRow } from '../orchestration/types'
import {
  createAppRunHarness,
  seedTask,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import type { JsonObject } from '../orchestration/db/autopilot-json-column'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getTaskClassificationStore } from '../orchestration/db/task-classification-store'
import { getTaskRouteStore } from '../orchestration/db/task-route-store'
import type { TaskSpecInput } from '../orchestration/db/task-spec-store'
import type { ExecutorRunReport } from './executor-run-report'

export const FIXTURE_NOW_MS = Date.parse('2026-10-05T12:00:00.000Z')
export const FIXTURE_CLI = 'orca'

export type RouteFixture = {
  readonly target: ExecutionTarget
  readonly model: string | null
  readonly policyLevel: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'inherit'
  readonly taskType: string
  readonly subject: RouteSubject
  /** The value the resolved CLI setting sends; null sends no effort. */
  readonly effort: string | null
}

export const CODEX_ROUTE: RouteFixture = {
  target: 'codex_cli',
  model: 'gpt-6.1-sol',
  policyLevel: 'max',
  taskType: 'general_research_analysis',
  subject: {
    target: 'codex_cli',
    model: 'gpt-6.1-sol',
    reasoningLevel: 'max',
    requirement: 'required',
    inheritsCoordinator: false
  },
  effort: 'max'
}

export const AGY_ROUTE: RouteFixture = {
  target: 'agy_cli',
  model: 'gemini-3.8-flash-high',
  policyLevel: 'high',
  taskType: 'fast_writing_or_alternative_draft',
  subject: {
    target: 'agy_cli',
    model: 'gemini-3.8-flash-high',
    reasoningLevel: 'high',
    requirement: 'if_supported',
    inheritsCoordinator: false
  },
  effort: null
}

export const SUBAGENT_ROUTE: RouteFixture = {
  target: 'claude_subagent',
  model: 'claude-sonnet-5-5',
  policyLevel: 'max',
  taskType: 'software_engineering',
  subject: {
    target: 'claude_subagent',
    model: 'claude-sonnet-5-5',
    reasoningLevel: 'max',
    requirement: 'required',
    inheritsCoordinator: false
  },
  effort: 'max'
}

export const WORKFLOW_ROUTE: RouteFixture = {
  target: 'claude_workflow',
  model: null,
  policyLevel: 'inherit',
  taskType: 'configured_project_workflow',
  subject: {
    target: 'claude_workflow',
    model: 'claude-opus-5-5',
    reasoningLevel: 'max',
    requirement: 'required',
    inheritsCoordinator: true
  },
  effort: null
}

export const PRIMARY_ROUTE: RouteFixture = {
  target: 'claude_primary',
  model: 'claude-opus-5-5',
  policyLevel: 'max',
  taskType: 'complex_planning_reasoning',
  subject: {
    target: 'claude_primary',
    model: 'claude-opus-5-5',
    reasoningLevel: 'max',
    requirement: 'required',
    inheritsCoordinator: false
  },
  effort: 'max'
}

const SNAPSHOT = {
  checkedAtMs: FIXTURE_NOW_MS,
  freshness: 'dispatch',
  workspaceKind: 'git-worktree',
  checks: [],
  observedAtMs: { detection: FIXTURE_NOW_MS, models: FIXTURE_NOW_MS, rateLimits: null }
} as const

export function availableResult(route: RouteFixture): RouteAvailabilityResult {
  return {
    subject: route.subject,
    snapshot: SNAPSHOT,
    status: 'available',
    reasons: [],
    cli: {
      target: route.subject.target,
      model: route.subject.model,
      effort: route.effort,
      effortDelivery: route.target === 'agy_cli' ? 'agy_model_id_variant' : 'codex_config_override',
      requestedLevel: route.subject.reasoningLevel,
      requirement: route.subject.requirement,
      resolution: route.target === 'agy_cli' ? 'encoded_in_model_id' : 'applied'
    }
  }
}

export function unavailableResult(
  route: RouteFixture,
  reasons: readonly [UnavailableReason, ...UnavailableReason[]]
): RouteAvailabilityResult {
  return { subject: route.subject, snapshot: SNAPSHOT, status: 'unavailable', reasons, cli: null }
}

/** A task with its TaskSpec, a classification and the route C2 would record, ready for task-start. */
export function seedRoutedAppTask(
  harness: AppRunHarness,
  route: RouteFixture,
  options: { spec?: Partial<TaskSpecInput>; availability?: JsonObject | null } = {}
): { taskId: string; classificationId: string; routeId: string } {
  const { taskId } = seedTask(harness, { spec: options.spec })
  const classification = getTaskClassificationStore(harness.owner).record({
    taskId,
    attempt: 1,
    outcome: 'classified',
    detail: null,
    needsDelegation: true,
    taskType: route.taskType,
    answers: null,
    bundleSha256: 'd'.repeat(64),
    taxonomyVersion: 2,
    profileSha256: 'e'.repeat(64),
    classifierModel: 'fixture-classifier',
    rawResponseId: null,
    spendReservationId: null,
    timestamp: fixtureTime(2)
  })
  const stored = getTaskRouteStore(harness.owner).record({
    classificationId: classification.classificationId,
    routingTableVersion: 1,
    routingTableSha256: 'c'.repeat(64),
    target: route.target,
    model: route.model,
    policyLevel: route.policyLevel,
    cliSetting: null,
    status: 'available',
    reasons: [],
    availability:
      options.availability === undefined
        ? { subject: route.subject, status: 'available', reasons: [] }
        : options.availability,
    timestamp: fixtureTime(3)
  })
  return { taskId, classificationId: classification.classificationId, routeId: stored.routeId }
}

/** A task the classification kept with the primary (needs_delegation false): a not_delegated route row. */
export function seedKeptAppTask(harness: AppRunHarness): { taskId: string; routeId: string } {
  const { taskId } = seedTask(harness)
  const classification = getTaskClassificationStore(harness.owner).record({
    taskId,
    attempt: 1,
    outcome: 'classified',
    detail: null,
    needsDelegation: false,
    taskType: 'coordinator_reasoning',
    answers: null,
    bundleSha256: 'd'.repeat(64),
    taxonomyVersion: 2,
    profileSha256: 'e'.repeat(64),
    classifierModel: 'fixture-classifier',
    rawResponseId: null,
    spendReservationId: null,
    timestamp: fixtureTime(2)
  })
  const stored = getTaskRouteStore(harness.owner).record({
    classificationId: classification.classificationId,
    routingTableVersion: 1,
    routingTableSha256: 'c'.repeat(64),
    target: null,
    model: null,
    policyLevel: null,
    cliSetting: null,
    status: 'not_delegated',
    reasons: [],
    availability: null,
    timestamp: fixtureTime(3)
  })
  return { taskId, routeId: stored.routeId }
}

/** A clean, completed run as a runner would report it on a host that proves only the root's exit. */
export function completedReport(overrides: Partial<ExecutorRunReport> = {}): ExecutorRunReport {
  return {
    verdict: { status: 'completed' },
    spawned: true,
    exitCode: 0,
    cancellation: { requested: false },
    treeProof: { verdict: 'unverifiable', method: 'root_exit_only' },
    lastMessage: { sha256: 'f'.repeat(64), bytes: 120, secretLike: false },
    usage: { inputTokens: 10, outputTokens: 5 },
    threadId: 'thread-fixture-1',
    facts: { versionProbe: 'ok' },
    sandbox: { requested: 'read_only', applied: 'read_only' },
    ...overrides
  }
}

export type AnnounceSpy = {
  readonly messages: MessageRow[]
  readonly announce: (m: MessageRow) => void
}

export function announceSpy(): AnnounceSpy {
  const messages: MessageRow[] = []
  return { messages, announce: (message) => messages.push(message) }
}

/** A promise with its resolver, so a test decides when a fake run ends. */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

export { createAppRunHarness, type AppRunHarness }
