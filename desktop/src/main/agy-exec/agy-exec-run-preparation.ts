import { createAgyRunDirectory, type AgyRunLocation } from './agy-exec-run-directory'
import { validateAgyExecRequest, type ValidatedAgyExecRequest } from './agy-exec-request-validation'
import type { AgyExecApplied, AgyExecFailure } from './agy-exec-types'

export type PreparedAgyExecRun = {
  readonly applied: AgyExecApplied
  readonly argv: readonly string[]
  readonly worktreePath: string
  readonly location: AgyRunLocation
}

export type AgyPreparationResult =
  | { readonly ok: true; readonly run: PreparedAgyExecRun }
  | { readonly ok: false; readonly failure: AgyExecFailure }

export type AgyPreparationDeps = {
  readonly platform: NodeJS.Platform
  readonly tempRoots: () => readonly string[]
}

/** A last refusal before anything is created, such as a launch target that must not start. */
export type BeforeCreate = (request: ValidatedAgyExecRequest) => Promise<AgyExecFailure | null>

/** Validate, run the last checks, then create the run directory; a refused run leaves nothing behind. */
export async function prepareAgyExecRun(
  request: unknown,
  deps: AgyPreparationDeps,
  beforeCreate: BeforeCreate
): Promise<AgyPreparationResult> {
  const checked = validateAgyExecRequest(request, deps.platform)
  if (!checked.ok) {
    return checked
  }
  const refusal = await beforeCreate(checked.value)
  if (refusal !== null) {
    return { ok: false, failure: refusal }
  }
  const { applied, argv, worktreePath, runsRoot, runId } = checked.value
  const created = await createAgyRunDirectory({
    runsRoot,
    runId,
    worktreePath,
    platform: deps.platform,
    forbiddenRoots: deps.tempRoots()
  })
  if (!created.ok) {
    return { ok: false, failure: { kind: created.kind, detail: created.detail } }
  }
  return { ok: true, run: { applied, argv, worktreePath, location: created.value } }
}
