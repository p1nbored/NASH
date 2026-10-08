import {
  createNativeReviewer,
  type NativeReviewerDeps,
  type ReviewerRunner
} from './reviewer-runner'

export type CodexReviewerDeps = NativeReviewerDeps

export function createCodexReviewer(deps: CodexReviewerDeps): ReviewerRunner {
  return createNativeReviewer('codex', deps)
}
