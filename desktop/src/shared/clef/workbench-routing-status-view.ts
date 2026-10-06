import { z } from 'zod'
import { CLEF_CREDENTIAL_PROTECTIONS } from './clef-credential-contract'
import { RoutingStatusSchema } from './clef-route-contract'

/**
 * Renderer-safe view behind `workbench.routing.status`: configuration status, the question bundle,
 * latch and circuit times. Every field is a flag, a count, a time, a threshold or a public bundle
 * hash, so nothing here can carry a token, an account id or a URL; each object is strict so a widened
 * main-side value fails. Clef has no spend cap (D-022), so the view reports none.
 */

const CountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const TimestampSchema = z.iso.datetime({ offset: true })
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/)
const VersionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
const ProbabilitySchema = z.number().min(0).max(1)

/** Bundle values that may still await the user's confirmation (D-020); the values are in the hash, this list is not. */
export const CLEF_BUNDLE_CONFIRMATION_ITEMS = [
  'thresholds',
  'task_type_options',
  'needs_delegation_criteria'
] as const
export type ClefBundleConfirmationItem = (typeof CLEF_BUNDLE_CONFIRMATION_ITEMS)[number]

/** The question bundle main sends Clef: never its texts, only versions, hash and thresholds. */
export const ClefBundleViewSchema = z
  .object({
    questionSetVersion: VersionSchema,
    taxonomyVersion: VersionSchema,
    sha256: Sha256HexSchema,
    thresholds: z
      .object({
        delegationTrueMin: ProbabilitySchema,
        delegationFalseMax: ProbabilitySchema,
        taskTypeMarginMin: ProbabilitySchema
      })
      .strict(),
    awaitingUserConfirmation: z
      .array(z.enum(CLEF_BUNDLE_CONFIRMATION_ITEMS))
      .max(CLEF_BUNDLE_CONFIRMATION_ITEMS.length)
      .refine((items) => new Set(items).size === items.length, 'Items repeat')
  })
  .strict()
export type ClefBundleView = z.infer<typeof ClefBundleViewSchema>

export const WorkbenchRoutingStatusViewSchema = z
  .object({
    status: RoutingStatusSchema,
    /** False until a dispatch handoff exists; routing alone never launches an agent. */
    dispatch: z.boolean(),
    credentials: z
      .object({
        tokenPresent: z.boolean(),
        accountPresent: z.boolean(),
        protection: z.enum(CLEF_CREDENTIAL_PROTECTIONS)
      })
      .strict(),
    profile: z
      .object({
        present: z.boolean(),
        responseModelPinned: z.boolean(),
        verifiedAt: TimestampSchema.nullable(),
        /** The bundle the stored profile was verified against, even when it no longer applies. */
        verifiedAgainstBundleSha256: Sha256HexSchema.nullable()
      })
      .strict(),
    bundle: ClefBundleViewSchema,
    latches: z
      .object({ authFailed: z.boolean(), quotaLatchedUntil: TimestampSchema.nullable() })
      .strict(),
    circuit: z
      .object({
        state: z.enum(['closed', 'open', 'half_open']),
        reopensAt: TimestampSchema.nullable(),
        consecutiveTransient: CountSchema
      })
      .strict()
  })
  .strict()

export type WorkbenchRoutingStatusView = z.infer<typeof WorkbenchRoutingStatusViewSchema>

/** Null for anything that is not exactly a status view, so the renderer never trusts a widened payload. */
export function parseWorkbenchRoutingStatusView(value: unknown): WorkbenchRoutingStatusView | null {
  const parsed = WorkbenchRoutingStatusViewSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
