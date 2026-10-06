import { OrchestrationError } from '../orchestration/orchestration-error'

/** Coarse reasons the endpoint could not be opened; never an error message, a path or the token. */
export const DOT_INGRESS_FAILURES = [
  'listen_failed',
  'metadata_invalid',
  'metadata_write_failed',
  'metadata_not_secured'
] as const
export type DotIngressFailure = (typeof DOT_INGRESS_FAILURES)[number]

export type DotIngressStatus = Readonly<{
  /** The persisted switch as last read. */
  enabled: boolean
  /** Whether the endpoint is open. It never says a dot is linked: the interface cannot know. */
  listening: boolean
  failure: DotIngressFailure | null
}>

/** What the desktop settings handler uses after it changes the persisted switch. */
export type DotIngressControl = {
  /** Aligns the endpoint with the persisted switch: opens it when on, tears it down when off. */
  sync(): Promise<DotIngressStatus>
  status(): DotIngressStatus
}

/** Reads the persisted switch; installed by whoever owns the database, so the transport has no storage dependency. */
export type DotIngressEnabledReader = () => boolean

/**
 * The seam between the RPC server (which owns the endpoint) and the code that owns the switch. It is
 * keyed by runtime object instead of being a runtime member, so a partial runtime in a test needs no
 * extra method.
 */
export class DotIngressPort {
  private control: DotIngressControl | null = null
  private enabledReader: DotIngressEnabledReader | null = null

  installControl(control: DotIngressControl): void {
    this.control = control
  }

  /** Removes `control` only if it is still the installed one, so a stale server cannot drop a newer control. */
  uninstallControl(control: DotIngressControl): void {
    if (this.control === control) {
      this.control = null
    }
  }

  installEnabledReader(reader: DotIngressEnabledReader): void {
    this.enabledReader = reader
  }

  /** Off unless a reader says exactly true; a failing reader keeps the interface off. */
  readEnabled(): boolean {
    if (!this.enabledReader) {
      return false
    }
    try {
      return this.enabledReader() === true
    } catch {
      // Why: no message is logged, because a database error text can carry a path.
      console.warn(
        '[dot-ingress] The interface switch could not be read; keeping the interface off.'
      )
      return false
    }
  }

  requireControl(): DotIngressControl {
    if (!this.control) {
      throw new OrchestrationError(
        'workbench_dot_ingress_unavailable',
        'The dot interface is not available in this runtime.'
      )
    }
    return this.control
  }
}

const ports = new WeakMap<object, DotIngressPort>()

export function getDotIngressPort(runtime: object): DotIngressPort {
  let port = ports.get(runtime)
  if (!port) {
    port = new DotIngressPort()
    ports.set(runtime, port)
  }
  return port
}
