// One spelling per model: CLIs name a model with effort variants, dates, provider paths and aliases.

const CONTEXT_SUFFIX = /\[[^\]]*\]$/
// D-027: none, minimal and ultra are effort variants too.
const VARIANT_SUFFIX = /-(?:none|minimal|low|medium|high|xhigh|max|ultra|thinking)$/
const DATE_SNAPSHOT_SUFFIX = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/
const FLOATING_SUFFIX = /-latest$/
const SHORT_CLAUDE_ID = /^(opus|sonnet|haiku|fable)-(\d+(?:-\d+)*)$/
const MODEL_ID_SYNTAX = /^[a-z0-9][a-z0-9._:-]{0,127}$/
// Why: these resolve to whatever is current, so they name no fixed model to compare.
const FLOATING_ALIASES: ReadonlySet<string> = new Set([
  'opus',
  'sonnet',
  'haiku',
  'fable',
  'opusplan',
  'default',
  'best',
  'auto',
  'latest',
  'inherit'
])

/** One spelling per model, or null when the id names no fixed model. */
export function normalizeModelId(modelId: string | null | undefined): string | null {
  if (typeof modelId !== 'string') {
    return null
  }
  const lowered = modelId.trim().toLowerCase().replace(CONTEXT_SUFFIX, '')
  const id = lowered.slice(lowered.lastIndexOf('/') + 1)
  if (!MODEL_ID_SYNTAX.test(id) || FLOATING_ALIASES.has(id) || FLOATING_SUFFIX.test(id)) {
    return null
  }
  const base = id.replace(VARIANT_SUFFIX, '').replace(DATE_SNAPSHOT_SUFFIX, '')
  const short = SHORT_CLAUDE_ID.exec(base)
  return short ? `claude-${short[1]}-${short[2]}` : base
}

/** Version dots fold too (claude-opus-4.5 is claude-opus-4-5); only for comparing, never for lookups. */
function comparisonKey(modelId: string | null | undefined): string | null {
  return normalizeModelId(modelId)?.replaceAll('.', '-') ?? null
}

/** True or false when both ids name a fixed model; null when either is unknown, so callers fail closed. */
export function isSameModel(
  left: string | null | undefined,
  right: string | null | undefined
): boolean | null {
  const a = comparisonKey(left)
  const b = comparisonKey(right)
  return a === null || b === null ? null : a === b
}
