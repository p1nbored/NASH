import type { TreeMethod, TreeProof, TreeVerdict } from '../agent-exec-shared/tree-termination'

// Vocabulary for the headless agy runner; no electron import, so a plain Node host can load it.

/** The efforts agy 1.2.14 documents; a variant id such as gemini-3.8-flash-high needs none. */
export const AGY_EXEC_EFFORTS = ['low', 'medium', 'high', 'max'] as const
export type AgyExecEffort = (typeof AGY_EXEC_EFFORTS)[number]

/** Everything the runner needs for one run; effort stays a string because routing data is validated here. */
export type AgyExecRequest = {
  /** English per D-013 (quoted spans may be any script); it travels on argv as `--print=<prompt>`. */
  readonly prompt: string
  /** An exact agy model id such as gemini-3.8-flash-high; agy's own default is never used. */
  readonly model: string
  /** The label agy shows for the model; only screened for the Gemini 4 family, never sent. */
  readonly modelLabel?: string
  /** Omit for a variant id; whether `--effort` combines with one is unverified. */
  readonly effort?: string
  /** D-025: true runs agy with `--sandbox` (a read-only run); false adds no flag (a write run). */
  readonly sandbox: boolean
  /** Absolute path of an existing directory; becomes the working directory. */
  readonly worktreePath: string
  /** Absolute, app-private directory that already exists; every run gets a fresh child of it. */
  readonly runsRoot: string
  /** Names the run directory under runsRoot: letters, digits, `_` and `-`, 1 to 64 characters. */
  readonly runId: string
}

/** Model and effort exactly as requested via argv; not proof of what the service ran. */
export type AgyExecApplied = {
  readonly model: string
  readonly effort: AgyExecEffort | null
}

export type AgyExecFailureKind =
  | 'invalid_request'
  | 'run_dir_unusable'
  | 'executable_not_launchable'
  | 'spawn_failed'
  | 'cancelled'
  | 'timed_out'
  | 'descendant_outlived_root'
  | 'nonzero_exit'
  | 'output_empty'
  | 'output_oversized'
  | 'output_unwritable'

export type AgyExecFailure = {
  readonly kind: AgyExecFailureKind
  readonly detail: string
}

/** A failed or blocked verdict always names at least one failure; the first is primary. */
export type AgyExecFailures = readonly [AgyExecFailure, ...AgyExecFailure[]]

export type AgyExecVerdict =
  | { readonly status: 'completed' }
  | { readonly status: 'failed'; readonly failures: AgyExecFailures }
  | {
      readonly status: 'blocked'
      readonly reason: 'quota' | 'auth'
      /** Always true: the mapping is text matching, not a structured error code. */
      readonly heuristic: true
      readonly matchedText: string
      readonly failures: AgyExecFailures
    }

/** The tree vocabulary lives with the shared termination code; these keep the agy names. */
export type AgyExecTreeVerdict = TreeVerdict
export type AgyExecTreeMethod = TreeMethod
export type AgyExecTreeProof = TreeProof

/** What was done to stop the run and what is known: `exited` needs an observed root exit plus positive evidence about descendants. */
export type AgyExecCancellation =
  | { readonly requested: false }
  | {
      readonly requested: true
      readonly trigger: 'abort_signal' | 'timeout'
      readonly spawned: boolean
      readonly verdict: AgyExecTreeVerdict
      readonly method: AgyExecTreeMethod
      readonly rootExited: boolean
      readonly escalatedToForce: boolean
    }

/**
 * Where the run's answer stands. The full text is in the file at `path` (raw, so treat it as sensitive until
 * `secretLike` is false); `preview` is the redacted, bounded head that is safe to show or store.
 */
export type AgyExecOutputRecord =
  | {
      readonly state: 'ok'
      readonly path: string
      readonly bytes: number
      readonly sha256: string
      /** A credential shape occurs in the text, which agy's sandbox does not stop it from reading. */
      readonly secretLike: boolean
      readonly preview: string
      readonly previewTruncated: boolean
    }
  | {
      readonly state: 'empty' | 'oversized' | 'unwritable' | 'not_read'
      readonly path: null
      /** For `oversized`, the bytes seen before the run was stopped; otherwise null. */
      readonly bytes: number | null
      readonly sha256: null
      readonly secretLike: null
      readonly preview: ''
      readonly previewTruncated: false
    }
