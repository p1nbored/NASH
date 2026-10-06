// Shared vocabulary for the headless `codex exec` runner; no electron import, so a plain Node host can load it.
import type { TreeMethod, TreeProof, TreeVerdict } from '../agent-exec-shared/tree-termination'

/** Every effort codex accepts; the route check passes one only where `model/list` lists it (D-027). */
export const CODEX_EXEC_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
] as const
export type CodexExecEffort = (typeof CODEX_EXEC_EFFORTS)[number]

/** danger-full-access is never a legal value for this runner. */
export const CODEX_EXEC_SANDBOXES = ['read-only', 'workspace-write'] as const
export type CodexExecSandbox = (typeof CODEX_EXEC_SANDBOXES)[number]

/** Everything the runner needs for one run; effort and sandbox stay strings because routing data is validated here. */
export type CodexExecRequest = {
  /** English per D-013 (quoted spans may be any script); sent on stdin, never in argv. */
  readonly prompt: string
  readonly model: string
  readonly effort: string
  /** Omitted: no `--sandbox`, so codex exec applies its own default (read-only, per its docs). */
  readonly sandbox?: string
  /** Absolute path of an existing directory; becomes `--cd`. */
  readonly worktreePath: string
  /** Absolute, app-private directory that already exists; every run gets a fresh child of it. */
  readonly runsRoot: string
  /** Names the run directory under runsRoot: letters, digits, `_` and `-`, 1 to 64 characters. */
  readonly runId: string
  /** When set, passed as `--output-schema` and the last message is re-validated against it. */
  readonly outputSchema?: Readonly<Record<string, unknown>>
  readonly ephemeral?: boolean
  /** Passes `--skip-git-repo-check`, for a folder workspace that is not a git repository (D-027). */
  readonly skipGitRepoCheck?: boolean
}

/** Model and settings exactly as requested via argv; not proof of what the service ran. */
export type CodexExecApplied = {
  readonly model: string
  readonly effort: CodexExecEffort
  /** Null when no `--sandbox` was passed. */
  readonly sandbox: CodexExecSandbox | null
  readonly ephemeral: boolean
  readonly outputSchema: boolean
  readonly skipGitRepoCheck: boolean
}

/** Token counts as the stream reported them; a field the stream omitted stays null. */
export type CodexExecUsage = {
  readonly inputTokens: number | null
  readonly cachedInputTokens: number | null
  readonly outputTokens: number | null
  readonly reasoningOutputTokens: number | null
}

export type CodexExecFailureKind =
  | 'invalid_request'
  | 'run_dir_unusable'
  | 'executable_not_launchable'
  | 'spawn_failed'
  | 'cancelled'
  | 'timed_out'
  | 'descendant_outlived_root'
  | 'nonzero_exit'
  | 'missing_thread_started'
  | 'duplicate_thread_started'
  | 'turn_failed'
  | 'error_event'
  | 'missing_final_turn_completed'
  | 'oversized_control_event'
  | 'malformed_control_event'
  | 'last_message_missing'
  | 'last_message_empty'
  | 'last_message_oversized'
  | 'schema_unvalidatable'
  | 'output_schema_violation'

export type CodexExecFailure = {
  readonly kind: CodexExecFailureKind
  readonly detail: string
}

/** A failed or blocked verdict always names at least one failure; the first is primary. */
export type CodexExecFailures = readonly [CodexExecFailure, ...CodexExecFailure[]]

export type CodexExecVerdict =
  | { readonly status: 'completed' }
  | { readonly status: 'failed'; readonly failures: CodexExecFailures }
  | {
      readonly status: 'blocked'
      readonly reason: 'quota' | 'auth'
      /** Always true: the mapping is text matching, not a structured error code. */
      readonly heuristic: true
      readonly matchedText: string
      readonly failures: CodexExecFailures
    }

/** The tree vocabulary lives with the shared termination code; these keep the Codex names. */
export type CodexExecTreeVerdict = TreeVerdict
export type CodexExecTreeMethod = TreeMethod
export type CodexExecTreeProof = TreeProof

/** What was done to stop the run and what is known: `exited` needs an observed root exit plus positive evidence about descendants. */
export type CodexExecCancellation =
  | { readonly requested: false }
  | {
      readonly requested: true
      readonly trigger: 'abort_signal' | 'timeout'
      readonly spawned: boolean
      readonly verdict: CodexExecTreeVerdict
      readonly method: CodexExecTreeMethod
      readonly rootExited: boolean
      readonly escalatedToForce: boolean
    }
