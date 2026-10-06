import type { RuntimeTerminalAgentStatus } from '../../../shared/runtime-types'

/** Orca's terminal agent status read (`OrcaRuntimeService.getTerminalAgentStatus`). */
export type AgentStatusReader = (handle: string) => Promise<RuntimeTerminalAgentStatus>

/**
 * `open`: a permission or question dialog is showing (Orca's PermissionRequest status hook, or the
 * approval prompt on screen). `closed`: an agent runs there and shows no dialog. `unknown`: the
 * terminal is gone, the read failed, or no agent runs there.
 */
export type AgentDialogState = 'open' | 'closed' | 'unknown'

/**
 * The dialog read for one pane. D-019: a mid-run message may be typed only on `closed`; treat
 * `unknown` like `open`.
 */
export async function readAgentDialogState(
  read: AgentStatusReader,
  handle: string
): Promise<AgentDialogState> {
  try {
    const status = await read(handle)
    if (!status.isRunningAgent) {
      return 'unknown'
    }
    return status.status === 'permission' ? 'open' : 'closed'
  } catch {
    return 'unknown'
  }
}

/** After this many failed reads in a row the observer stops watching; the expiry sweep closes it. */
export const PERMISSION_OBSERVER_MAX_UNKNOWN_READS = 3

export type TerminalAnswerSink = {
  isPending(decisionId: string): boolean
  markAnsweredInTerminal(decisionId: string): void
}

type Watch = { handle: string; armed: boolean; open: boolean; unknownReads: number }

/**
 * Closes a prompt as `answered_in_terminal` when its pane showed the dialog and then left it while
 * the prompt was still pending, which means nobody answered through the relay. A prompt whose dialog
 * was never seen is never closed here.
 */
export class PermissionTerminalObserver {
  private readonly watches = new Map<string, Watch>()

  constructor(private readonly deps: { readStatus: AgentStatusReader; sink: TerminalAnswerSink }) {}

  get size(): number {
    return this.watches.size
  }

  watch(decisionId: string, handle: string): void {
    if (!this.watches.has(decisionId)) {
      this.watches.set(decisionId, { handle, armed: false, open: false, unknownReads: 0 })
    }
  }

  unwatch(decisionId: string): void {
    this.watches.delete(decisionId)
  }

  /** The prompt's dialog was seen and is still open, so it must stay pending for the terminal. */
  holds(decisionId: string): boolean {
    const watch = this.watches.get(decisionId)
    return Boolean(watch?.armed && watch.open)
  }

  async poll(): Promise<void> {
    const handles = new Set([...this.watches.values()].map((watch) => watch.handle))
    const states = new Map<string, AgentDialogState>()
    await Promise.all(
      [...handles].map(async (handle) => {
        states.set(handle, await readAgentDialogState(this.deps.readStatus, handle))
      })
    )
    for (const [decisionId, watch] of this.watches) {
      this.apply(decisionId, watch, states.get(watch.handle) ?? 'unknown')
    }
  }

  private apply(decisionId: string, watch: Watch, state: AgentDialogState): void {
    if (!this.deps.sink.isPending(decisionId)) {
      this.watches.delete(decisionId)
      return
    }
    if (state === 'unknown') {
      const unknownReads = watch.unknownReads + 1
      // Why keep `open`: one failed read must not let the sweep expire a dialog still on screen.
      if (unknownReads >= PERMISSION_OBSERVER_MAX_UNKNOWN_READS) {
        this.watches.delete(decisionId)
      } else {
        this.watches.set(decisionId, { ...watch, unknownReads })
      }
      return
    }
    if (state === 'open') {
      this.watches.set(decisionId, { ...watch, armed: true, open: true, unknownReads: 0 })
      return
    }
    if (watch.armed) {
      this.watches.delete(decisionId)
      this.deps.sink.markAnsweredInTerminal(decisionId)
      return
    }
    this.watches.set(decisionId, { ...watch, open: false, unknownReads: 0 })
  }
}
