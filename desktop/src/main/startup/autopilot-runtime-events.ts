// What the autopilot wiring logs: a fixed event name plus codes and ids, never error text (which can
// carry a path, a command line or a secret).

export type AutopilotRuntimeLogEvent = {
  readonly event:
    | 'install_step_failed'
    | 'install_step_skipped'
    | 'validation_failed'
    | 'classification_failed'
    | 'classification_notice_failed'
    | 'task_api_event'
    | 'execution_event'
    | 'shutdown_pending'
    | 'shutdown_step_failed'
    | 'dot_remote_event'
  readonly step?: string
  readonly code?: string
  readonly missing?: readonly string[]
  readonly detail?: string
  readonly runId?: string
  readonly taskId?: string
  readonly dispatchId?: string
}

export type AutopilotRuntimeLog = (event: AutopilotRuntimeLogEvent) => void
