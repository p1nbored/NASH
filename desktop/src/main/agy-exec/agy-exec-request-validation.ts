import { statSync } from 'node:fs'
import { isLocalAbsolutePath } from '../agent-exec-shared/path-containment'
import { boundText } from '../agent-exec-shared/secret-redaction'
import { AgyExecArgvError, buildAgyExecArgv, isAgyExecEffort } from './agy-exec-argv'
import { locateAgyRunDirectory, type AgyRunLocation } from './agy-exec-run-directory'
import type { AgyExecApplied, AgyExecFailure } from './agy-exec-types'

// Pure checks on an untrusted request: every field is verified before anything is created or started.

export type ValidatedAgyExecRequest = {
  readonly applied: AgyExecApplied
  readonly argv: readonly string[]
  readonly worktreePath: string
  readonly runsRoot: string
  readonly runId: string
  readonly location: AgyRunLocation
}

export type AgyRequestValidation =
  | { readonly ok: true; readonly value: ValidatedAgyExecRequest }
  | { readonly ok: false; readonly failure: AgyExecFailure }

/** The only fields a request may carry; anything else, such as a mode or a resume flag, is refused by name. */
const ACCEPTED_FIELDS: ReadonlySet<string> = new Set([
  'prompt',
  'model',
  'modelLabel',
  'effort',
  'sandbox',
  'worktreePath',
  'runsRoot',
  'runId'
])

const MAX_FIELD_NAME_CHARS = 64

function rejected(detail: string): AgyRequestValidation {
  return { ok: false, failure: { kind: 'invalid_request', detail } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type StringFields = {
  readonly prompt: string
  readonly model: string
  readonly worktreePath: string
  readonly runsRoot: string
  readonly runId: string
}

function readStringFields(request: Record<string, unknown>): StringFields | null {
  const { prompt, model, worktreePath, runsRoot, runId } = request
  return typeof prompt === 'string' &&
    typeof model === 'string' &&
    typeof worktreePath === 'string' &&
    typeof runsRoot === 'string' &&
    typeof runId === 'string'
    ? { prompt, model, worktreePath, runsRoot, runId }
    : null
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Absolute and local: a UNC or device path would make statSync and the CLI reach the network. */
function worktreeProblem(path: string, platform: NodeJS.Platform): string | null {
  const usable = isLocalAbsolutePath(path, platform) && !path.startsWith('-')
  return usable && isExistingDirectory(path)
    ? null
    : 'The worktree must be an absolute path to an existing directory.'
}

function optionalFieldProblem(request: Record<string, unknown>): string | null {
  const { modelLabel, effort, sandbox } = request
  if (typeof sandbox !== 'boolean') {
    return 'sandbox must be true or false.'
  }
  if (modelLabel !== undefined && typeof modelLabel !== 'string') {
    return 'modelLabel must be a string when given.'
  }
  return effort !== undefined && !isAgyExecEffort(effort)
    ? 'invalid_effort: effort must be one of the documented values when given.'
    : null
}

function buildValidated(
  fields: StringFields,
  request: Record<string, unknown>,
  location: AgyRunLocation
): AgyRequestValidation {
  const { effort, modelLabel } = request
  try {
    const argv = buildAgyExecArgv({
      sandbox: request.sandbox === true,
      prompt: fields.prompt,
      model: fields.model,
      modelLabel: typeof modelLabel === 'string' ? modelLabel : undefined,
      effort: typeof effort === 'string' ? effort : undefined
    })
    const applied: AgyExecApplied = {
      model: fields.model,
      effort: isAgyExecEffort(effort) ? effort : null
    }
    const { worktreePath, runsRoot, runId } = fields
    return { ok: true, value: { applied, argv, worktreePath, runsRoot, runId, location } }
  } catch (error) {
    if (error instanceof AgyExecArgvError) {
      return rejected(`${error.code}: ${error.message}`)
    }
    throw error
  }
}

export function validateAgyExecRequest(
  request: unknown,
  platform: NodeJS.Platform
): AgyRequestValidation {
  if (!isRecord(request)) {
    return rejected('The request must be an object.')
  }
  const unknownField = Object.keys(request).find((key) => !ACCEPTED_FIELDS.has(key))
  if (unknownField !== undefined) {
    return rejected(
      `The field ${boundText(unknownField, MAX_FIELD_NAME_CHARS).text} is not accepted.`
    )
  }
  const fields = readStringFields(request)
  if (fields === null) {
    return rejected('prompt, model, worktreePath, runsRoot and runId must be strings.')
  }
  const problem = optionalFieldProblem(request) ?? worktreeProblem(fields.worktreePath, platform)
  if (problem !== null) {
    return rejected(problem)
  }
  const located = locateAgyRunDirectory(fields, platform)
  if (!located.ok) {
    return rejected(located.detail)
  }
  return buildValidated(fields, request, located.value)
}
