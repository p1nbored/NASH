// A reviewer only reads and answers once; model-review-verdict.ts parses the answer.

export type ReviewerRequest = {
  /** English; delivered on stdin, never in argv. */
  readonly prompt: string
  readonly model: string
  /** The CLI setting the availability check resolved; null sends no effort flag. */
  readonly effort: string | null
  /** The workspace a reviewer may read; null when it is not a local directory. */
  readonly workspacePath: string | null
  /** A folder workspace is no git repository; the Codex reviewer then skips its git check (D-027). */
  readonly workspaceKind?: 'git' | 'folder'
  /** Names the reviewer's own run directory: letters, digits, `_` and `-`, 1 to 64 characters. */
  readonly runId: string
  readonly outputSchema: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
}

export type ReviewerRunOutcome =
  | {
      readonly status: 'completed'
      readonly text: string
      readonly outputSha256: string
      /** Models the CLI itself reported serving the run; empty when it reported none. */
      readonly reportedModels: readonly string[]
    }
  /** The CLI reported an auth or quota failure; the route is latched by the caller. */
  | { readonly status: 'blocked'; readonly reason: 'auth' | 'quota' }
  | { readonly status: 'failed'; readonly reason: string }
  /** Nothing was started: the runner cannot run this request here. */
  | { readonly status: 'unavailable'; readonly reason: string }

export type ReviewerRunner = (request: ReviewerRequest) => Promise<ReviewerRunOutcome>
