import { open } from 'node:fs/promises'
import { compileOutputSchema, type CompiledOutputSchema } from './codex-exec-output-schema'
import {
  validateCodexExecRequest,
  type ValidatedCodexExecRequest
} from './codex-exec-request-validation'
import { createRunDirectory, type RunLocation } from './codex-exec-run-directory'
import type { CodexExecLimits } from './codex-exec-run-options'
import type { CodexExecApplied, CodexExecFailure } from './codex-exec-types'

const PRIVATE_FILE_MODE = 0o600

export type PreparedCodexExecRun = {
  readonly applied: CodexExecApplied
  readonly argv: readonly string[]
  readonly prompt: string
  readonly worktreePath: string
  readonly location: RunLocation
  /** Present only when the request declared an output schema. */
  readonly schema: Extract<CompiledOutputSchema, { ok: true }> | null
}

export type PreparationResult =
  | { readonly ok: true; readonly run: PreparedCodexExecRun }
  | { readonly ok: false; readonly failure: CodexExecFailure }

export type PreparationDeps = {
  readonly platform: NodeJS.Platform
  readonly tempRoots: () => readonly string[]
}

/** Exclusive create: it fails on an existing file or link instead of writing through it. */
async function writeSchemaFile(path: string, schema: Readonly<Record<string, unknown>>) {
  const handle = await open(path, 'wx', PRIVATE_FILE_MODE)
  try {
    await handle.writeFile(JSON.stringify(schema), 'utf8')
  } finally {
    await handle.close()
  }
}

function fail(kind: CodexExecFailure['kind'], detail: string): PreparationResult {
  return { ok: false, failure: { kind, detail } }
}

/** A last refusal before anything is created, such as a launch target that must not start. */
export type BeforeCreate = (request: ValidatedCodexExecRequest) => Promise<CodexExecFailure | null>

/** Validate, compile any schema, run the last checks, then create the run directory; a refused run leaves nothing behind. */
export async function prepareCodexExecRun(
  request: unknown,
  limits: Pick<CodexExecLimits, 'maxPromptBytes'>,
  deps: PreparationDeps,
  beforeCreate: BeforeCreate = async () => null
): Promise<PreparationResult> {
  const checked = validateCodexExecRequest(request, limits, deps.platform)
  if (!checked.ok) {
    return checked
  }
  const { outputSchema, location } = checked.value
  const compiled = outputSchema === undefined ? null : compileOutputSchema(outputSchema)
  if (compiled !== null && !compiled.ok) {
    return fail('schema_unvalidatable', compiled.detail)
  }
  const refusal = await beforeCreate(checked.value)
  if (refusal !== null) {
    return { ok: false, failure: refusal }
  }
  const created = await createRunDirectory({
    runsRoot: checked.value.runsRoot,
    runId: checked.value.runId,
    worktreePath: checked.value.worktreePath,
    platform: deps.platform,
    forbiddenRoots: deps.tempRoots()
  })
  if (!created.ok) {
    return fail(created.kind, created.detail)
  }
  try {
    if (outputSchema !== undefined) {
      await writeSchemaFile(location.schemaPath, outputSchema)
    }
  } catch {
    return fail('run_dir_unusable', 'The output schema file could not be written.')
  }
  const { applied, argv, prompt, worktreePath } = checked.value
  return { ok: true, run: { applied, argv, prompt, worktreePath, location, schema: compiled } }
}
