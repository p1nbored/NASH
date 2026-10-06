import { statSync } from 'node:fs'
import { isLocalAbsolutePath } from '../agent-exec-shared/path-containment'
import {
  CODEX_EXEC_EFFORTS,
  CODEX_EXEC_SANDBOXES,
  type CodexExecEffort,
  type CodexExecSandbox
} from './codex-exec-types'

export type CodexExecArgvErrorCode =
  | 'invalid_effort'
  | 'invalid_sandbox'
  | 'invalid_model_slug'
  | 'invalid_worktree'
  | 'invalid_path'

export class CodexExecArgvError extends Error {
  readonly code: CodexExecArgvErrorCode

  constructor(code: CodexExecArgvErrorCode, message: string) {
    super(message)
    this.name = 'CodexExecArgvError'
    this.code = code
  }
}

export type CodexExecArgvInput = {
  readonly model: string
  readonly effort: string
  /** Omitted: no `--sandbox`, so codex exec applies its own default (read-only, per its docs). */
  readonly sandbox?: string
  readonly worktreePath: string
  readonly lastMessagePath: string
  readonly outputSchemaPath?: string
  readonly ephemeral?: boolean
  readonly skipGitRepoCheck?: boolean
}

/** Lowercase dotted/dashed slug such as gpt-6.1-sol; no leading dash, no doubled separator. */
const MODEL_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const MAX_MODEL_SLUG_LENGTH = 64

export function isCodexExecEffort(value: unknown): value is CodexExecEffort {
  return CODEX_EXEC_EFFORTS.some((effort) => effort === value)
}

export function isCodexExecSandbox(value: unknown): value is CodexExecSandbox {
  return CODEX_EXEC_SANDBOXES.some((sandbox) => sandbox === value)
}

export function isCodexExecModelSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_MODEL_SLUG_LENGTH &&
    MODEL_SLUG_PATTERN.test(value)
  )
}

/** Absolute and local: a UNC or device path would make statSync and the CLI reach the network. */
function isUsablePath(path: unknown): path is string {
  return isLocalAbsolutePath(path, process.platform) && !path.startsWith('-')
}

function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Refuse any input the argv could not be built from, with a typed error. */
function assertBuildable(input: CodexExecArgvInput): void {
  if (!isCodexExecModelSlug(input.model)) {
    throw new CodexExecArgvError(
      'invalid_model_slug',
      'Model slug does not match the strict pattern.'
    )
  }
  if (!isCodexExecEffort(input.effort)) {
    throw new CodexExecArgvError(
      'invalid_effort',
      `Effort must be one of ${CODEX_EXEC_EFFORTS.join(', ')}.`
    )
  }
  if (input.sandbox !== undefined && !isCodexExecSandbox(input.sandbox)) {
    throw new CodexExecArgvError(
      'invalid_sandbox',
      `Sandbox must be one of ${CODEX_EXEC_SANDBOXES.join(', ')} when given.`
    )
  }
  if (!isUsablePath(input.worktreePath) || !isExistingDirectory(input.worktreePath)) {
    throw new CodexExecArgvError(
      'invalid_worktree',
      'Worktree must be an absolute path to an existing directory.'
    )
  }
  for (const path of [input.lastMessagePath, input.outputSchemaPath]) {
    if (path !== undefined && !isUsablePath(path)) {
      throw new CodexExecArgvError('invalid_path', 'Output paths must be absolute.')
    }
  }
}

/** Build the argv for one headless run or throw a typed error; the prompt goes to stdin, never argv. */
export function buildCodexExecArgv(input: CodexExecArgvInput): readonly string[] {
  assertBuildable(input)
  return [
    'exec',
    '--json',
    '--model',
    input.model,
    '-c',
    `model_reasoning_effort="${input.effort}"`,
    ...(input.sandbox === undefined ? [] : ['--sandbox', input.sandbox]),
    '--cd',
    input.worktreePath,
    '--ignore-user-config',
    '--ignore-rules',
    '--output-last-message',
    input.lastMessagePath,
    ...(input.outputSchemaPath === undefined ? [] : ['--output-schema', input.outputSchemaPath]),
    ...(input.ephemeral === true ? ['--ephemeral'] : []),
    ...(input.skipGitRepoCheck === true ? ['--skip-git-repo-check'] : []),
    '-'
  ]
}
