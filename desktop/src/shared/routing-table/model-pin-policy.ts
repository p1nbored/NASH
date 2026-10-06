import { z } from 'zod'

/** Why a model id can never pin a route (ARCH 7.5); exact-allowlist membership is checked by the router. */
export type ModelPinViolation =
  | 'model_family_excluded'
  | 'model_alias_unpinned'
  | 'model_slug_rejected'
  | 'model_unapproved'

// Why: ARCH 7.5 family denylist; a bare "4" must not be followed by another digit (gemini-40 is not Gemini 4).
const GEMINI_4_FAMILY = /gemini[\s._-]*4(?![0-9])|argon/i
const MODEL_ID_SYNTAX = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,199}$/
// Why: these selectors resolve to whatever is current wherever they appear, so they pin nothing.
const FLOATING_SELECTOR_TOKEN = /(?:^|[._:/@-])(?:auto|latest|inherit)(?=$|[._:/@-])/i
// Why: tier words and aliases also occur inside exact slugs (claude-opus-5-5), so only a bare one floats.
// The Claude aliases mirror Orca's session catalog; model-pin-policy.test.ts guards the drift.
const BARE_ALIASES: ReadonlySet<string> = new Set([
  'auto',
  'latest',
  'inherit',
  'flash',
  'pro',
  'opus',
  'sonnet',
  'haiku',
  'fable',
  'opusplan',
  'spark'
])
/** Sibling `gpt-6-sol` and retired `gpt-5.3-codex-spark` (OAIV C2, M9). */
const REJECTED_SLUGS: ReadonlySet<string> = new Set(['gpt-6-sol', 'gpt-5.3-codex-spark'])

function lastSegment(model: string): string {
  return model.slice(Math.max(model.lastIndexOf('/'), model.lastIndexOf(':')) + 1).toLowerCase()
}

/** Null when the id may pin a model; never approves one on its own. */
export function modelPinViolation(model: string): ModelPinViolation | null {
  if (GEMINI_4_FAMILY.test(model)) {
    return 'model_family_excluded'
  }
  if (!MODEL_ID_SYNTAX.test(model)) {
    return 'model_unapproved'
  }
  const segment = lastSegment(model)
  if (FLOATING_SELECTOR_TOKEN.test(model) || BARE_ALIASES.has(segment)) {
    return 'model_alias_unpinned'
  }
  return REJECTED_SLUGS.has(segment) ? 'model_slug_rejected' : null
}

/** A model id that can pin a launch: exact slug syntax, no alias, selector, Gemini 4 or rejected slug. */
export const PinnedModelIdSchema = z
  .string()
  .refine((model) => modelPinViolation(model) === null, 'Model must be an exact pinned slug')
