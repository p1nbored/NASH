import {
  workspaceKindForWorktreeId,
  type WorkspaceLaunchKind
} from '../../../shared/workspace-launch-kind'
import type { CodexExecutable } from '../../codex-exec/codex-exec-executable'
import {
  AGENT_MODEL_CATALOG_FAILURE_TTL_MS,
  AGENT_MODEL_CATALOG_FRESH_MS
} from '../../native-chat/agent-model-catalog/agent-model-catalog-store'
import type { RateLimitHeadroomState } from './route-provider-headroom'
import { createBoundedRateLimitRead } from './route-rate-limit-refresh'
import { checkAgyRoute } from './agy-route-checks'
import { checkClaudeRoute } from './claude-route-checks'
import { checkCodexRoute, readCodexExecutable } from './codex-route-checks'
import type { ModelListing } from './model-listing'
import { limitsForProvider } from './route-auth-quota-checks'
import type { RouteAvailabilityStore } from './route-availability-store'
import {
  providerForSubject,
  routeKeyOf,
  type EvaluateFreshness,
  type LatchKind,
  type LiveRunPrimary,
  type RouteAvailabilityResult,
  type RouteProvider,
  type RouteSubject
} from './route-availability-types'
import { buildRouteResult } from './route-check-aggregation'
import type {
  CodexExecutableReading,
  RouteCheckResult,
  RouteObservations
} from './route-check-observations'
import {
  readAgentDetection,
  type AgentDetectionReading,
  type AgentDetectionSources
} from './route-cli-detection-check'
import { applyLatches } from './route-latch-check'

/** What an evaluation reads from outside; the runtime binds these to Orca's own services. */
export type AvailabilityPorts = {
  readonly now: () => number
  readonly detection: AgentDetectionSources
  /** One session-less listing per provider; never rejects (a failure is `ok: false`). */
  readonly models: Readonly<Record<RouteProvider, () => Promise<ModelListing>>>
  readonly rateLimits: {
    /** The rate-limit service state; observation only. */
    read(): RateLimitHeadroomState | null
    /** The service's refresh; its result is ignored because the state is always read afterwards. */
    refresh(): Promise<unknown>
  }
  /** `resolveCodexExecutable`, bound the way the runner resolves it; throws when codex cannot launch. */
  readonly resolveCodexExecutable: () => CodexExecutable
}

export type WorkspaceRef = { readonly workspaceId: string } | { readonly kind: WorkspaceLaunchKind }

export type EvaluateOptions = {
  /** `cached` reads only what is held; `dispatch` bounds the age; `recheck` reads everything again. */
  readonly freshness: EvaluateFreshness
  /** The workspace the work would run in; leave out for a table-wide view. */
  readonly workspace?: WorkspaceRef | null
  /** Ends a bounded wait for the rate-limit refresh. */
  readonly signal?: AbortSignal
  /** Proof that this run's primary session is live; lets in-session Claude routes inherit its login. */
  readonly liveRunPrimary?: LiveRunPrimary | null
}

export type EvaluatorWaits = {
  /** How long a dispatch check waits for a listing before calling it unobserved. */
  readonly dispatchMs: number
  readonly recheckMs: number
}

export type RouteAvailabilityEvaluator = {
  evaluate(
    subjects: readonly RouteSubject[],
    options: EvaluateOptions
  ): Promise<readonly RouteAvailabilityResult[]>
  /** Records an executor-reported auth or quota failure; the route stays unavailable until a re-check. */
  latch(subject: RouteSubject, kind: LatchKind): void
  /** Forgets every cached listing and the detection, for example after an account switch; latches stay. */
  invalidate(): void
}

/** Cached detection is reused for this long at dispatch (spec 3.2: cached detection). */
export const DETECTION_MAX_AGE_MS = 60_000
export const DEFAULT_EVALUATOR_WAITS: EvaluatorWaits = { dispatchMs: 20_000, recheckMs: 60_000 }

const NEVER_ABORTED = new AbortController().signal
// Why: only a codex route reads this, and it is only computed for a batch that has one.
const CODEX_NOT_READ: CodexExecutableReading = { ok: false, code: 'unexpected' }

function workspaceKindOf(workspace: WorkspaceRef | null | undefined): WorkspaceLaunchKind | null {
  if (!workspace) {
    return null
  }
  return 'kind' in workspace ? workspace.kind : workspaceKindForWorktreeId(workspace.workspaceId)
}

function finiteOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null
}

/** The promise's value, or null when it has not settled within `ms`; `work` must never reject. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    void work.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

type DetectionObservation = { reading: AgentDetectionReading; observedAtMs: number | null }
const DETECTION_UNOBSERVED: DetectionObservation = { reading: { ok: false }, observedAtMs: null }

function checkRoute(
  provider: RouteProvider,
  subject: RouteSubject,
  observations: RouteObservations
): RouteCheckResult {
  switch (provider) {
    case 'codex':
      return checkCodexRoute(subject, observations)
    case 'agy':
      return checkAgyRoute(subject, observations)
    case 'claude':
      return checkClaudeRoute(subject, observations)
  }
}

export function createRouteAvailabilityEvaluator(deps: {
  ports: AvailabilityPorts
  store: RouteAvailabilityStore
  waits?: Partial<EvaluatorWaits>
}): RouteAvailabilityEvaluator {
  const { ports, store } = deps
  const waits: EvaluatorWaits = { ...DEFAULT_EVALUATOR_WAITS, ...deps.waits }
  const listingsInFlight = new Map<RouteProvider, Promise<ModelListing>>()
  let detectionInFlight: Promise<DetectionObservation> | null = null
  // Why an epoch: a probe that settles after invalidate() describes the old account and is not stored.
  let epoch = 0
  const limitsRead = {
    refresh: () => ports.rateLimits.refresh(),
    read: () => ports.rateLimits.read(),
    now: ports.now
  }
  const readLimitsAtDispatch = createBoundedRateLimitRead(limitsRead)
  const readLimitsAtRecheck = createBoundedRateLimitRead({ ...limitsRead, minIntervalMs: 0 })

  function startListing(provider: RouteProvider): Promise<ModelListing> {
    const running = listingsInFlight.get(provider)
    if (running) {
      return running
    }
    const startedAt = epoch
    // Why stored even after a wait gave up: the next evaluation then finds the late answer in the store.
    const run = Promise.resolve()
      .then(() => ports.models[provider]())
      .catch((): ModelListing => ({ ok: false, observedAtMs: ports.now() }))
      .then((listing) => {
        if (startedAt === epoch) {
          store.putListing(provider, listing)
          listingsInFlight.delete(provider)
        }
        return listing
      })
    listingsInFlight.set(provider, run)
    return run
  }

  function startDetection(): Promise<DetectionObservation> {
    if (detectionInFlight !== null) {
      return detectionInFlight
    }
    const startedAt = epoch
    const run = readAgentDetection(ports.detection).then((reading): DetectionObservation => {
      const observedAtMs = reading.ok ? ports.now() : null
      if (startedAt === epoch) {
        detectionInFlight = null
        if (observedAtMs !== null) {
          store.putDetection(reading, observedAtMs)
        }
      }
      return { reading, observedAtMs }
    })
    detectionInFlight = run
    return run
  }

  /** A good listing is trusted for ten minutes, a failed one for thirty seconds (Orca's catalog bounds). */
  function isUsable(listing: ModelListing, nowMs: number): boolean {
    const age = nowMs - listing.observedAtMs
    if (age < 0) {
      return false
    }
    return listing.ok
      ? age <= AGENT_MODEL_CATALOG_FRESH_MS
      : age < AGENT_MODEL_CATALOG_FAILURE_TTL_MS
  }

  async function obtainListing(
    provider: RouteProvider,
    freshness: EvaluateFreshness
  ): Promise<ModelListing> {
    const held = store.getListing(provider)
    if (freshness === 'cached') {
      return held ?? { ok: false, observedAtMs: ports.now() }
    }
    if (freshness === 'dispatch' && held !== null && isUsable(held, ports.now())) {
      return held
    }
    const limitMs = freshness === 'recheck' ? waits.recheckMs : waits.dispatchMs
    const answered = await withDeadline(startListing(provider), limitMs)
    return answered ?? { ok: false, observedAtMs: ports.now() }
  }

  async function obtainDetection(freshness: EvaluateFreshness): Promise<DetectionObservation> {
    const held = store.getDetection()
    if (freshness === 'cached') {
      return held ?? DETECTION_UNOBSERVED
    }
    if (freshness === 'dispatch' && held !== null) {
      const age = ports.now() - held.observedAtMs
      if (age >= 0 && age <= DETECTION_MAX_AGE_MS) {
        return held
      }
    }
    const limitMs = freshness === 'recheck' ? waits.recheckMs : waits.dispatchMs
    return (await withDeadline(startDetection(), limitMs)) ?? DETECTION_UNOBSERVED
  }

  async function obtainRateLimits(
    freshness: EvaluateFreshness,
    signal: AbortSignal
  ): Promise<RateLimitHeadroomState | null> {
    try {
      if (freshness === 'cached') {
        return ports.rateLimits.read()
      }
      return await (freshness === 'recheck' ? readLimitsAtRecheck : readLimitsAtDispatch)(signal)
    } catch {
      // Why null: an unreadable service is unobserved, never a pass and never a rejection.
      return null
    }
  }

  return {
    async evaluate(subjects, options) {
      if (subjects.length === 0) {
        return []
      }
      const { freshness } = options
      const providers = [...new Set(subjects.map((subject) => providerForSubject(subject)))]
      const [detection, rateLimits, listed] = await Promise.all([
        obtainDetection(freshness),
        obtainRateLimits(freshness, options.signal ?? NEVER_ABORTED),
        Promise.all(
          providers.map(async (provider): Promise<[RouteProvider, ModelListing]> => [
            provider,
            await obtainListing(provider, freshness)
          ])
        )
      ])
      const listings = new Map(listed)
      const nowMs = ports.now()
      const workspaceKind = workspaceKindOf(options.workspace)
      const codexExecutable = providers.includes('codex')
        ? readCodexExecutable(ports.resolveCodexExecutable)
        : CODEX_NOT_READ
      return subjects.map((subject) => {
        const provider = providerForSubject(subject)
        const listing: ModelListing = listings.get(provider) ?? { ok: false, observedAtMs: nowMs }
        const observations: RouteObservations = {
          nowMs,
          detection: detection.reading,
          listing,
          rateLimits,
          workspaceKind,
          codexExecutable,
          liveRunPrimary: options.liveRunPrimary ?? null
        }
        const key = routeKeyOf(subject)
        const limitsUpdatedAtMs = finiteOrNull(limitsForProvider(rateLimits, provider)?.updatedAt)
        const raw = checkRoute(provider, subject, observations)
        const latched = applyLatches({
          checks: raw.checks,
          latches: store.latchesFor(key),
          freshness,
          limitsUpdatedAtMs,
          cliAnsweredAtMs: listing.ok ? listing.observedAtMs : null
        })
        for (const kind of latched.cleared) {
          store.clearLatch(key, kind)
        }
        return buildRouteResult(
          subject,
          { checks: latched.checks, mapping: raw.mapping },
          {
            freshness,
            nowMs,
            workspaceKind,
            observedAtMs: {
              detection: detection.observedAtMs,
              models: listing.ok ? listing.observedAtMs : null,
              rateLimits: limitsUpdatedAtMs
            }
          }
        )
      })
    },
    latch(subject, kind) {
      store.addLatch({ routeKey: routeKeyOf(subject), kind, latchedAtMs: ports.now() })
    },
    invalidate() {
      epoch += 1
      listingsInFlight.clear()
      detectionInFlight = null
      store.clearObservations()
    }
  }
}
