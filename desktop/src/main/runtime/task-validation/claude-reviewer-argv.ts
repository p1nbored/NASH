import { modelPinViolation } from '../../../shared/routing-table/model-pin-policy'

// Every flag below is listed by the installed Claude Code 2.1.289 --help (cli-probe-out/claude-help.txt).
// The reviewer runs with Claude Code's own default settings (D-027 restriction 30).

export const CLAUDE_REVIEW_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const MODEL_SLUG = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const MAX_MODEL_CHARS = 64

export class ClaudeReviewArgvError extends Error {}

function isEffort(value: string): value is (typeof CLAUDE_REVIEW_EFFORTS)[number] {
  return CLAUDE_REVIEW_EFFORTS.some((effort) => effort === value)
}

function checkModel(model: string): void {
  if (
    model.length > MAX_MODEL_CHARS ||
    !MODEL_SLUG.test(model) ||
    modelPinViolation(model) !== null
  ) {
    throw new ClaudeReviewArgvError('The reviewer model must be an exact pinned model id.')
  }
}

export function buildClaudeReviewArgv(input: { model: string; effort: string | null }): string[] {
  checkModel(input.model)
  if (input.effort !== null && !isEffort(input.effort)) {
    throw new ClaudeReviewArgvError('The reviewer effort is not one Claude Code lists.')
  }
  return [
    '-p',
    '--output-format',
    'json',
    '--model',
    input.model,
    ...(input.effort === null ? [] : ['--effort', input.effort]),
    '--no-session-persistence'
  ]
}
