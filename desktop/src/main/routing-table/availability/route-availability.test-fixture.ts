// FIXTURE_ONLY: listings and rate-limit readings shaped like the read-only CLI probe evidence of
// 2026-10-05 (Claude 2.1.289, Codex 0.160.0, agy 1.2.14). Nothing here is read from a real CLI.
import type { ProviderRateLimits, RateLimitWindow } from '../../../shared/rate-limit-types'
import type { RateLimitHeadroomState } from './route-provider-headroom'
import type { ListedModel, ModelListing } from './model-listing'
import type { ReasoningRequirement, RouteSubject, RouteTarget } from './route-availability-types'
import type { RouteObservations } from './route-check-observations'
import type { AgentDetectionReading } from './route-cli-detection-check'

export const NOW_MS = Date.parse('2026-10-05T12:00:00Z')

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const

/** Aliases resolve to full ids, as the CLI's picker lists them; Haiku has no effort control. */
export const CLAUDE_MODELS: readonly ListedModel[] = [
  { id: 'opus', resolvedModel: 'claude-opus-5-5', label: 'Opus 5.5', efforts: CLAUDE_EFFORTS },
  {
    id: 'sonnet',
    resolvedModel: 'claude-sonnet-5-5',
    label: 'Sonnet 5.5',
    efforts: CLAUDE_EFFORTS
  },
  { id: 'claude-fable-5-1', resolvedModel: null, label: 'Fable 5.1', efforts: CLAUDE_EFFORTS },
  { id: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', efforts: [] }
]

export const CODEX_MODELS: readonly ListedModel[] = [
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gpt-6-sol',
  'gpt-6-luna',
  'gpt-5.6-sol',
  'gpt-5.5'
].map((id) => ({ id, resolvedModel: null, label: id.toUpperCase(), efforts: CODEX_EFFORTS }))

const AGY_ROWS: readonly (readonly [string, string])[] = [
  ['gemini-3.8-flash-high', 'Gemini 3.8 Flash (High)'],
  ['gemini-3.8-flash-medium', 'Gemini 3.8 Flash (Medium)'],
  ['gemini-3.8-flash-low', 'Gemini 3.8 Flash (Low)'],
  ['gemini-3.7-flash-high', 'Gemini 3.7 Flash (High)'],
  ['gemini-3.1-pro-high', 'Gemini 3.1 Pro (High)'],
  ['gemini-3.1-pro-low', 'Gemini 3.1 Pro (Low)'],
  ['claude-opus-5-5-high', 'Claude Opus 5.5 (High)'],
  ['gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)']
]
export const AGY_MODELS: readonly ListedModel[] = AGY_ROWS.map(([id, label]) => ({
  id,
  resolvedModel: null,
  label,
  efforts: []
}))

export function listingOf(
  models: readonly ListedModel[],
  observedAtMs: number = NOW_MS
): ModelListing {
  return { ok: true, models, observedAtMs }
}

export function failedListing(observedAtMs: number = NOW_MS): ModelListing {
  return { ok: false, observedAtMs }
}

function window(usedPercent: number, resetsAt: number | null = null): RateLimitWindow {
  return { usedPercent, windowMinutes: 300, resetsAt, resetDescription: null }
}

export function limitsOf(
  provider: ProviderRateLimits['provider'],
  overrides: Partial<ProviderRateLimits> = {}
): ProviderRateLimits {
  return {
    provider,
    session: window(10),
    weekly: window(20),
    updatedAt: NOW_MS - 60_000,
    error: null,
    status: 'ok',
    ...overrides
  }
}

export function headroomOf(
  overrides: Partial<Record<'claude' | 'codex' | 'antigravity', ProviderRateLimits | null>> = {}
): RateLimitHeadroomState {
  return {
    claude: limitsOf('claude'),
    codex: limitsOf('codex'),
    antigravity: limitsOf('antigravity'),
    ...overrides
  }
}

export function subjectOf(
  target: RouteTarget,
  model: string,
  reasoningLevel: RouteSubject['reasoningLevel'],
  requirement: ReasoningRequirement = 'required',
  inheritsCoordinator = false
): RouteSubject {
  return { target, model, reasoningLevel, requirement, inheritsCoordinator }
}

export function detectionOf(
  installed: readonly string[] = ['claude', 'codex', 'antigravity'],
  disabled: readonly string[] = []
): AgentDetectionReading {
  return {
    ok: true,
    installed: new Set(installed),
    enabled: new Set(installed.filter((agent) => !disabled.includes(agent)))
  }
}

/** Observations in which every provider check passes; tests override what they probe. */
export function observationsOf(
  listing: ModelListing,
  overrides: Partial<RouteObservations> = {}
): RouteObservations {
  return {
    nowMs: NOW_MS,
    usageSource: 'orca-inherited',
    detection: detectionOf(),
    listing,
    rateLimits: headroomOf(),
    workspaceKind: 'git-worktree',
    codexExecutable: { ok: true, launch: 'direct', source: 'path-search' },
    liveRunPrimary: null,
    ...overrides
  }
}
