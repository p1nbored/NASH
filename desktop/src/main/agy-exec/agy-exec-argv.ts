import { modelPinViolation } from '../../shared/routing-table/model-pin-policy'
import { AGY_EXEC_EFFORTS, type AgyExecEffort } from './agy-exec-types'

export type AgyExecArgvErrorCode =
  | 'invalid_prompt'
  | 'invalid_model'
  | 'model_excluded'
  | 'invalid_effort'
  | 'invalid_sandbox'

export class AgyExecArgvError extends Error {
  readonly code: AgyExecArgvErrorCode

  constructor(code: AgyExecArgvErrorCode, message: string) {
    super(message)
    this.name = 'AgyExecArgvError'
    this.code = code
  }
}

export type AgyExecArgvInput = {
  /** D-025: true adds `--sandbox` (terminal restrictions) for a read-only run; false adds nothing. */
  readonly sandbox: boolean
  readonly prompt: string
  readonly model: string
  readonly modelLabel?: string
  readonly effort?: string
}

/** The prompt rides bound to the flag, so a prompt that starts with a dash stays a value. */
const BOUND_PROMPT_PREFIX = '--print='
/** Lowercase dotted/dashed slug such as gemini-3.8-flash-high; no leading dash, no doubled separator. */
const MODEL_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const MAX_MODEL_SLUG_LENGTH = 64
/** Orca's own sentinel for "omit --model and use the config default"; this runner never does that. */
const DEFAULT_MODEL_SENTINEL = 'default'

export function isAgyExecEffort(value: unknown): value is AgyExecEffort {
  return AGY_EXEC_EFFORTS.some((effort) => effort === value)
}

/** An exact pinned slug: not the default sentinel, not an alias or selector, not in the excluded family. */
export function isAgyExecModelId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== DEFAULT_MODEL_SENTINEL &&
    value.length <= MAX_MODEL_SLUG_LENGTH &&
    MODEL_SLUG_PATTERN.test(value) &&
    modelPinViolation(value) === null
  )
}

function isExcludedFamily(text: unknown): boolean {
  return typeof text === 'string' && modelPinViolation(text) === 'model_family_excluded'
}

/** Gemini 4 is refused by id and by label before any other check, then the id must be an exact pinned slug. */
function assertModelAllowed(model: unknown, label: unknown): asserts model is string {
  if (isExcludedFamily(model) || isExcludedFamily(label)) {
    throw new AgyExecArgvError('model_excluded', 'The Gemini 4 family is excluded (ARCH 7.5).')
  }
  if (!isAgyExecModelId(model)) {
    throw new AgyExecArgvError(
      'invalid_model',
      'The model must be an exact lowercase agy model id; aliases, selectors and the default are refused.'
    )
  }
}

// The prompt has no size cap here; the runner checks the whole command line the OS must start (D-027).
function assertPromptAllowed(prompt: unknown): asserts prompt is string {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new AgyExecArgvError('invalid_prompt', 'The prompt must be a non-empty string.')
  }
  if (prompt.includes('\u0000')) {
    throw new AgyExecArgvError('invalid_prompt', 'The prompt must not contain NUL characters.')
  }
}

function assertEffortAllowed(effort: unknown): void {
  if (!isAgyExecEffort(effort)) {
    throw new AgyExecArgvError(
      'invalid_effort',
      `Effort must be one of ${AGY_EXEC_EFFORTS.join(', ')}.`
    )
  }
}

function assertSandboxAllowed(sandbox: unknown): void {
  if (typeof sandbox !== 'boolean') {
    throw new AgyExecArgvError('invalid_sandbox', 'The sandbox input must be true or false.')
  }
}

/** Build `--print=<prompt> [--sandbox] --model <id> [--effort <v>]` or throw a typed error. */
export function buildAgyExecArgv(input: AgyExecArgvInput): readonly string[] {
  assertSandboxAllowed(input.sandbox)
  assertModelAllowed(input.model, input.modelLabel)
  assertPromptAllowed(input.prompt)
  if (input.effort !== undefined) {
    assertEffortAllowed(input.effort)
  }
  return [
    `${BOUND_PROMPT_PREFIX}${input.prompt}`,
    ...(input.sandbox ? ['--sandbox'] : []),
    '--model',
    input.model,
    ...(input.effort === undefined ? [] : ['--effort', input.effort])
  ]
}

/** The argv for a result record: the prompt is replaced by its length, so no objective text is kept. */
export function describeAgyExecArgv(argv: readonly string[]): readonly string[] {
  return argv.map((token, index) =>
    index === 0 && token.startsWith(BOUND_PROMPT_PREFIX)
      ? `${BOUND_PROMPT_PREFIX}[prompt omitted, ${token.length - BOUND_PROMPT_PREFIX.length} chars]`
      : token
  )
}
