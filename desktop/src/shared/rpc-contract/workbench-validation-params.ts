import { z } from 'zod'

/**
 * The desktop's "Check now" for task validation: one pass over the attempts still waiting for a
 * verdict. The answer is counts by outcome only; no task text, file content or path crosses the wire.
 */

export const WORKBENCH_VALIDATION_ERROR_CODES = {
  /** No validation runtime in this session: not installed, or the app is quitting. */
  unavailable: 'workbench_validation_unavailable',
  /** A pass is already queued or running; a second one would only wait behind it. */
  passRunning: 'workbench_validation_pass_running',
  /** The pass itself failed; the details stay in the app log. */
  passFailed: 'workbench_validation_pass_failed'
} as const

export const WorkbenchValidationCheckPendingParams = z.object({}).strict()

const Count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

export const WorkbenchValidationCheckPendingResultSchema = z
  .object({
    /** Attempts the pass looked at. */
    checked: Count,
    passed: Count,
    failed: Count,
    /** Settled as undecided: the user or dot decides them. */
    inconclusive: Count,
    /** Not settled by this pass, for example because another call was already deciding it. */
    skipped: Count
  })
  .refine(
    (counts) =>
      counts.checked === counts.passed + counts.failed + counts.inconclusive + counts.skipped,
    { message: 'checked must equal the sum of the outcomes' }
  )

export type WorkbenchValidationCheckPendingInput = z.infer<
  typeof WorkbenchValidationCheckPendingParams
>
export type WorkbenchValidationCheckPendingResult = z.infer<
  typeof WorkbenchValidationCheckPendingResultSchema
>
