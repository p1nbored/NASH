import { z } from 'zod'
import type { MachineCheck } from '../orchestration/db/task-spec-record'
import { ARTIFACT_ROOTS } from '../orchestration/db/autopilot-task-schema-definition'

/** The machine checks of v1; the kinds and their parameters belong to the validators, not the store. */
export const MACHINE_CHECK_KINDS = [
  'artifact_exists',
  'no_workspace_writes',
  'secret_scan_clean'
] as const
export type MachineCheckKind = (typeof MACHINE_CHECK_KINDS)[number]
export type ArtifactRoot = (typeof ARTIFACT_ROOTS)[number]

export type PlannedCheck =
  | { readonly kind: 'artifact_exists'; readonly path: string; readonly root: ArtifactRoot }
  | { readonly kind: 'no_workspace_writes' }
  | { readonly kind: 'secret_scan_clean' }
  /** A check the validators cannot run; it stays in its place and cannot decide. */
  | {
      readonly kind: 'invalid'
      readonly specKind: string
      readonly problem: 'unknown_kind' | 'invalid_parameters'
    }

/**
 * `default`: the primary session's report is the completion claim for a subagent or workflow.
 * A model review runs its TaskSpec's machine checks first.
 */
export type ValidationPlan =
  | { readonly policy: 'machine_checks'; readonly checks: readonly PlannedCheck[] }
  | { readonly policy: 'model_review'; readonly checks: readonly PlannedCheck[] }
  | { readonly policy: 'default' }

const Bare = <K extends MachineCheckKind>(kind: K) => z.object({ kind: z.literal(kind) }).strict()

const ArtifactExistsSchema = z
  .object({
    kind: z.literal('artifact_exists'),
    path: z.string().min(1),
    root: z.enum(ARTIFACT_ROOTS).default('worktree')
  })
  .strict()

function isMachineCheckKind(kind: string): kind is MachineCheckKind {
  return MACHINE_CHECK_KINDS.some((known) => known === kind)
}

function planOne(check: MachineCheck): PlannedCheck {
  const invalid = (problem: 'unknown_kind' | 'invalid_parameters'): PlannedCheck => ({
    kind: 'invalid',
    specKind: check.kind,
    problem
  })
  if (!isMachineCheckKind(check.kind)) {
    return invalid('unknown_kind')
  }
  if (check.kind === 'artifact_exists') {
    const parsed = ArtifactExistsSchema.safeParse(check)
    return parsed.success ? parsed.data : invalid('invalid_parameters')
  }
  const parsed = Bare(check.kind).safeParse(check)
  return parsed.success ? { kind: check.kind } : invalid('invalid_parameters')
}

/** The TaskSpec's machine checks where it lists any; a model review only when it asks for one (D-027). */
export function planValidation(spec: {
  readonly machineChecks: readonly MachineCheck[]
  readonly review?: 'model' | null
}): ValidationPlan {
  const checks = spec.machineChecks.map(planOne)
  if (spec.review === 'model') {
    return { policy: 'model_review', checks }
  }
  return checks.length > 0 ? { policy: 'machine_checks', checks } : { policy: 'default' }
}
