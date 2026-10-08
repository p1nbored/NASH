import {
  createNativeReviewer,
  type NativeReviewerDeps,
  type ReviewerRunner
} from './reviewer-runner'

export type ClaudeReviewerDeps = NativeReviewerDeps

export function createClaudeReviewer(deps: ClaudeReviewerDeps): ReviewerRunner {
  return createNativeReviewer('claude', deps)
}
