import { spawnProcess } from '../../shared/child-process/run-process'
import type { LaunchTarget } from './launch-target'
import { redactAndBound } from './secret-redaction'
import {
  inspectTreeAfterRootExit,
  terminateChildTree,
  type TreeProof,
  type TreeTerminationDeps,
  type TreeTerminationOutcome
} from './tree-termination'

// One child from spawn to settlement, for any headless CLI; each tool supplies only how its pipes are read.

export type SpawnedChild = ReturnType<typeof spawnProcess>

/** The reasons a session stops its child; the first two are the caller's, the rest are the session's own. */
export type ManagedChildTrigger =
  | 'abort_signal'
  | 'timeout'
  | 'drain_timeout'
  | 'post_exit_sweep'
  | 'output_limit'

/** What a tool's pipe handling owes the session; `close` flushes a last partial line and destroys the pipes. */
export type ChildIo = { readonly close: () => void }

export type ManagedChildSpec<TIo extends ChildIo, TSummary> = {
  readonly executable: LaunchTarget
  readonly argv: readonly string[]
  /** Written to stdin, which is then closed. */
  readonly stdinText: string
  readonly cwd: string
  readonly env: Record<string, string>
  readonly signal?: AbortSignal
  /** Null arms no timer: the run ends when the CLI ends or the caller aborts (D-027). */
  readonly timeoutMs: number | null
  readonly graceMs: number
  readonly verifyMs: number
  /** How long to wait for output a surviving helper holds open after the root exits. */
  readonly drainGraceMs: number
  /** Decides whether the child leads its own process group; defaults to the host platform. */
  readonly platform?: NodeJS.Platform
  readonly termination?: Partial<TreeTerminationDeps>
  /** Subscribes to the pipes; `requestStop` lets the tool end a run that broke a limit. */
  readonly attachIo: (child: SpawnedChild, requestStop: (trigger: 'output_limit') => void) => TIo
  /** Read once at settlement, after the pipes are closed. */
  readonly summarize: (io: TIo) => TSummary
}

/** Stops the user asked for, and sweeps the session itself started when a helper outlived the root. */
export type ManagedChildTermination = {
  readonly trigger: ManagedChildTrigger
  readonly outcome: TreeTerminationOutcome
}

export type ManagedChildOutcome<TSummary> =
  | { readonly kind: 'not_started'; readonly spawnError: string }
  | {
      readonly kind: 'ran'
      readonly exitCode: number | null
      readonly exitSignal: NodeJS.Signals | null
      readonly summary: TSummary
      /** A helper held stdout open past the drain grace after the root exited. */
      readonly stdoutDrainTimedOut: boolean
      /** A helper held the output open or lived on after the root exited, so it may still write. */
      readonly descendantOutlivedRoot: boolean
      readonly termination: ManagedChildTermination | null
      /** What is known about the whole tree at the end, from the termination or the exit probe. */
      readonly treeProof: TreeProof
    }

type SessionPhase = 'running' | 'draining' | 'terminating' | 'settled'
type ExitInfo = { readonly code: number | null; readonly signal: NodeJS.Signals | null }
type Timer = ReturnType<typeof setTimeout> | undefined

const MAX_SPAWN_ERROR_CHARS = 300

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return redactAndBound(message, MAX_SPAWN_ERROR_CHARS).text
}

function startChild<TIo extends ChildIo, TSummary>(
  spec: ManagedChildSpec<TIo, TSummary>,
  platform: NodeJS.Platform
): SpawnedChild {
  return spawnProcess({
    program: spec.executable.program,
    args: [...spec.executable.prefixArgs, ...spec.argv],
    cwd: spec.cwd,
    env: spec.env,
    // Why: tree termination on POSIX signals the process group, so the child leads its own.
    detached: platform !== 'win32'
  })
}

class ManagedChildSession<TIo extends ChildIo, TSummary> {
  private phase: SessionPhase = 'running'
  private exit: ExitInfo | null = null
  private drainTimedOut = false
  private descendantOutlived = false
  private termination: ManagedChildTermination | null = null
  private proof: TreeProof = { verdict: 'unverifiable', method: 'root_exit_only' }
  private timeoutTimer: Timer
  private drainTimer: Timer
  private readonly platform: NodeJS.Platform
  private readonly io: TIo

  constructor(
    private readonly spec: ManagedChildSpec<TIo, TSummary>,
    private readonly child: SpawnedChild,
    private readonly resolve: (outcome: ManagedChildOutcome<TSummary>) => void
  ) {
    this.platform = spec.platform ?? process.platform
    this.io = spec.attachIo(child, (trigger) => this.begin(trigger))
  }

  start(): void {
    this.child.once('error', (error) => this.onError(error))
    this.child.once('exit', (code, signal) => this.onExit({ code, signal }))
    this.child.once('close', () => this.onClose())
    const { timeoutMs } = this.spec
    if (timeoutMs !== null) {
      this.timeoutTimer = this.startTimer(timeoutMs, () => this.begin('timeout'))
    }
    this.spec.signal?.addEventListener('abort', this.onAbort, { once: true })
    // Why check after subscribing: an abort that landed during spawn never fires the event.
    if (this.spec.signal?.aborted) {
      this.onAbort()
    }
    this.child.stdin.end(this.spec.stdinText)
  }

  private readonly onAbort = (): void => this.begin('abort_signal')

  private startTimer(delayMs: number, run: () => void): ReturnType<typeof setTimeout> {
    const timer = setTimeout(run, delayMs)
    timer.unref?.()
    return timer
  }

  private terminationDeps(): Partial<TreeTerminationDeps> {
    return { ...this.spec.termination, platform: this.platform }
  }

  private onError(error: Error): void {
    // An error from a process that did start is not a settlement: its close still follows.
    if (this.child.pid === undefined && this.phase !== 'settled') {
      this.phase = 'settled'
      this.cleanup()
      this.resolve({ kind: 'not_started', spawnError: describeError(error) })
    }
  }

  private onExit(exit: ExitInfo): void {
    this.exit = exit
    clearTimeout(this.timeoutTimer)
    if (this.phase === 'running') {
      this.phase = 'draining'
      this.drainTimer = this.startTimer(this.spec.drainGraceMs, () => this.onDrainTimeout())
    }
  }

  private onClose(): void {
    if (this.phase !== 'draining') {
      return
    }
    clearTimeout(this.drainTimer)
    const inspection = inspectTreeAfterRootExit(this.child, this.terminationDeps())
    this.proof = inspection.proof
    if (inspection.helperAlive) {
      this.descendantOutlived = true
      this.begin('post_exit_sweep')
      return
    }
    this.settle()
  }

  private onDrainTimeout(): void {
    this.drainTimedOut = true
    this.descendantOutlived = true
    this.begin('drain_timeout')
  }

  /** Move to `terminating` once; a later stop request while one is in flight changes nothing. */
  private begin(trigger: ManagedChildTrigger): void {
    if (this.phase === 'settled' || this.phase === 'terminating') {
      return
    }
    this.phase = 'terminating'
    clearTimeout(this.timeoutTimer)
    clearTimeout(this.drainTimer)
    this.runTermination(trigger).then(
      () => this.settle(),
      () => this.settle()
    )
  }

  private async runTermination(trigger: ManagedChildTrigger): Promise<void> {
    const outcome = await this.terminateTree()
    this.termination = { trigger, outcome }
    this.proof = { verdict: outcome.verdict, method: outcome.method }
  }

  private async terminateTree(): Promise<TreeTerminationOutcome> {
    try {
      return await terminateChildTree(this.child, {
        graceMs: this.spec.graceMs,
        verifyMs: this.spec.verifyMs,
        deps: this.terminationDeps()
      })
    } catch {
      // A termination that throws proves nothing, so it is reported as unverified.
      return {
        verdict: 'unverifiable',
        method: 'root_exit_only',
        rootExited: this.exit !== null,
        escalatedToForce: false
      }
    }
  }

  private cleanup(): void {
    clearTimeout(this.timeoutTimer)
    clearTimeout(this.drainTimer)
    this.spec.signal?.removeEventListener('abort', this.onAbort)
    this.io.close()
  }

  private settle(): void {
    if (this.phase === 'settled') {
      return
    }
    this.phase = 'settled'
    this.cleanup()
    this.resolve({
      kind: 'ran',
      exitCode: this.exit?.code ?? null,
      exitSignal: this.exit?.signal ?? null,
      summary: this.spec.summarize(this.io),
      stdoutDrainTimedOut: this.drainTimedOut,
      descendantOutlivedRoot: this.descendantOutlived,
      termination: this.termination,
      treeProof: this.proof
    })
  }
}

export function runManagedChild<TIo extends ChildIo, TSummary>(
  spec: ManagedChildSpec<TIo, TSummary>
): Promise<ManagedChildOutcome<TSummary>> {
  let child: SpawnedChild
  try {
    child = startChild(spec, spec.platform ?? process.platform)
  } catch (error) {
    return Promise.resolve({ kind: 'not_started', spawnError: describeError(error) })
  }
  return new Promise((resolve) => new ManagedChildSession(spec, child, resolve).start())
}
