import { z } from 'zod'
import { CLEF_CREDENTIAL_PROTECTIONS } from './clef-credential-contract'
import { RoutingStatusSchema } from './clef-route-contract'

/**
 * Local desktop view behind `workbench.routing.status`: only the configuration and verification
 * state the classifier settings use. Every object is strict so credential values cannot leak.
 */

const TimestampSchema = z.iso.datetime({ offset: true })
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/)

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
        verifiedAt: TimestampSchema.nullable(),
        /** The bundle the stored profile was verified against, even when it no longer applies. */
        verifiedAgainstBundleSha256: Sha256HexSchema.nullable()
      })
      .strict(),
    bundle: z.object({ sha256: Sha256HexSchema }).strict()
  })
  .strict()

export type WorkbenchRoutingStatusView = z.infer<typeof WorkbenchRoutingStatusViewSchema>

/** Null for anything that is not exactly a status view, so the renderer never trusts a widened payload. */
export function parseWorkbenchRoutingStatusView(value: unknown): WorkbenchRoutingStatusView | null {
  const parsed = WorkbenchRoutingStatusViewSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
