import { z } from 'zod'
import type { MachineCheck } from '../orchestration/db/task-spec-record'
import { ARTIFACT_ROOTS } from '../orchestration/db/autopilot-task-schema-definition'

/** The machine checks of v1; the kinds and their parameters belong to the validators, not the store. */
export const MACHINE_CHECK_KINDS = [
  'executor_completed',
  'artifact_exists',
  'output_schema',
  'no_workspace_writes',
  'secret_scan_clean'
] as const
export type MachineCheckKind = (typeof MACHINE_CHECK_KINDS)[number]
export type ArtifactRoot = (typeof ARTIFACT_ROOTS)[number]

export type PlannedCheck =
  | { readonly kind: 'executor_completed' }
  | { readonly kind: 'artifact_exists'; readonly path: string; readonly root: ArtifactRoot }
  | { readonly kind: 'output_schema'; readonly schema: Readonly<Record<string, unknown>> }
  | { readonly kind: 'no_workspace_writes' }
  | { readonly kind: 'secret_scan_clean' }
  /** A check the validators cannot run; it stays in its place and cannot decide. */
  | {
      readonly kind: 'invalid'
      readonly specKind: string
      readonly problem: 'unknown_kind' | 'invalid_parameters'
    }

/**
 * `default` (D-027): no machine checks and no review request, so the attempt passes on what NASH
 * observed of its process, or on the primary session's report for a subagent or workflow attempt.
 * A model review runs its TaskSpec's machine checks first.
 */
export type ValidationPlan =
  | { readonly policy: 'machine_checks'; readonly checks: readonly PlannedCheck[] }
  | { readonly policy: 'model_review'; readonly checks: readonly PlannedCheck[] }
  | { readonly policy: 'default' }

/** D-027: a Codex or agy attempt passes when its process finished with a result and nothing secret-shaped. */
export const DEFAULT_PROCESS_CHECKS: readonly PlannedCheck[] = [
  { kind: 'executor_completed' },
  { kind: 'secret_scan_clean' }
]

const Bare = <K extends MachineCheckKind>(kind: K) => z.object({ kind: z.literal(kind) }).strict()

const ArtifactExistsSchema = z
  .object({
    kind: z.literal('artifact_exists'),
    path: z.string().min(1),
    root: z.enum(ARTIFACT_ROOTS).default('worktree')
  })
  .strict()

const OutputSchemaParamsSchema = z
  .object({ kind: z.literal('output_schema'), schema: z.string().min(1) })
  .strict()

const JsonObjectText = z.record(z.string(), z.unknown())

function parseSchemaText(text: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed = JsonObjectText.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

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
  if (check.kind === 'output_schema') {
    const parsed = OutputSchemaParamsSchema.safeParse(check)
    const schema = parsed.success ? parseSchemaText(parsed.data.schema) : null
    return schema ? { kind: 'output_schema', schema } : invalid('invalid_parameters')
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
