import {
  CodexExecArgvError,
  buildCodexExecArgv,
  isCodexExecEffort,
  isCodexExecSandbox
} from './codex-exec-argv'
import { locateRunDirectory, type RunLocation } from './codex-exec-run-directory'
import type { CodexExecApplied, CodexExecFailure } from './codex-exec-types'

// Pure checks on an untrusted request: every field is verified before anything touches the disk.

export type ValidatedCodexExecRequest = {
  readonly applied: CodexExecApplied
  readonly argv: readonly string[]
  readonly prompt: string
  readonly worktreePath: string
  readonly runsRoot: string
  readonly runId: string
  readonly location: RunLocation
  readonly outputSchema: Readonly<Record<string, unknown>> | undefined
}

export type RequestValidation =
  | { readonly ok: true; readonly value: ValidatedCodexExecRequest }
  | { readonly ok: false; readonly failure: CodexExecFailure }

function rejected(detail: string): RequestValidation {
  return { ok: false, failure: { kind: 'invalid_request', detail } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function promptProblem(prompt: unknown, maxBytes: number): string | null {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return 'The prompt must be a non-empty string.'
  }
  if (prompt.includes('\u0000')) {
    return 'The prompt must not contain NUL characters.'
  }
  return Buffer.byteLength(prompt, 'utf8') > maxBytes
    ? `The prompt exceeds ${maxBytes} bytes.`
    : null
}

function optionalFieldProblem(request: Record<string, unknown>): string | null {
  const { ephemeral, skipGitRepoCheck, outputSchema } = request
  if (ephemeral !== undefined && typeof ephemeral !== 'boolean') {
    return 'ephemeral must be a boolean when given.'
  }
  if (skipGitRepoCheck !== undefined && typeof skipGitRepoCheck !== 'boolean') {
    return 'skipGitRepoCheck must be a boolean when given.'
  }
  return outputSchema !== undefined && !isRecord(outputSchema)
    ? 'outputSchema must be a JSON object when given.'
    : null
}

type StringFields = {
  readonly prompt: string
  readonly model: string
  readonly effort: string
  readonly sandbox: string | undefined
  readonly worktreePath: string
  readonly runsRoot: string
  readonly runId: string
}

function readStringFields(request: Record<string, unknown>): StringFields | null {
  const { prompt, model, effort, sandbox, worktreePath, runsRoot, runId } = request
  return typeof prompt === 'string' &&
    typeof model === 'string' &&
    typeof effort === 'string' &&
    (sandbox === undefined || typeof sandbox === 'string') &&
    typeof worktreePath === 'string' &&
    typeof runsRoot === 'string' &&
    typeof runId === 'string'
    ? { prompt, model, effort, sandbox, worktreePath, runsRoot, runId }
    : null
}

function buildValidated(
  fields: StringFields,
  request: Record<string, unknown>,
  location: RunLocation
): RequestValidation {
  const { model, effort, sandbox, worktreePath } = fields
  const outputSchema = isRecord(request.outputSchema) ? request.outputSchema : undefined
  const ephemeral = request.ephemeral === true
  const skipGitRepoCheck = request.skipGitRepoCheck === true
  try {
    const argv = buildCodexExecArgv({
      model,
      effort,
      sandbox,
      worktreePath,
      lastMessagePath: location.lastMessagePath,
      outputSchemaPath: outputSchema === undefined ? undefined : location.schemaPath,
      ephemeral,
      skipGitRepoCheck
    })
    // Type narrowing only, not a check: buildCodexExecArgv above already refused any other value.
    if (!isCodexExecEffort(effort) || (sandbox !== undefined && !isCodexExecSandbox(sandbox))) {
      return rejected('Effort or sandbox is not allowed.')
    }
    const applied = {
      model,
      effort,
      sandbox: sandbox ?? null,
      ephemeral,
      outputSchema: outputSchema !== undefined,
      skipGitRepoCheck
    }
    return { ok: true, value: { ...fields, applied, argv, location, outputSchema } }
  } catch (error) {
    if (error instanceof CodexExecArgvError) {
      return rejected(`${error.code}: ${error.message}`)
    }
    throw error
  }
}

export function validateCodexExecRequest(
  request: unknown,
  limits: { readonly maxPromptBytes: number },
  platform: NodeJS.Platform
): RequestValidation {
  if (!isRecord(request)) {
    return rejected('The request must be an object.')
  }
  const problem =
    promptProblem(request.prompt, limits.maxPromptBytes) ?? optionalFieldProblem(request)
  if (problem !== null) {
    return rejected(problem)
  }
  const located = locateRunDirectory({ runsRoot: request.runsRoot, runId: request.runId }, platform)
  if (!located.ok) {
    return rejected(located.detail)
  }
  const fields = readStringFields(request)
  if (fields === null) {
    return rejected(
      'model, effort, worktreePath, runsRoot and runId must be strings, and sandbox a string when given.'
    )
  }
  return buildValidated(fields, request, located.value)
}
