// What the process pipeline is asked to start; the launch checks and the evidence record read only these fields.

export type LaunchTarget = {
  /** Program handed to the process pipeline. */
  readonly program: string
  /** Arguments placed before the tool's own (the node entry script, when there is one). */
  readonly prefixArgs: readonly string[]
  /** The script or binary actually launched. */
  readonly entryPath: string
  /** The path as selected or discovered, before any shim resolution. */
  readonly requestedPath: string
  /** `powershell-script`: the program is PowerShell and the prefix runs the `.ps1` launcher with `-NoProfile -File`. */
  readonly launch: 'direct' | 'node-entry' | 'powershell-script'
  /** The program is the Electron binary, which behaves as Node only with ELECTRON_RUN_AS_NODE=1. */
  readonly electronRunAsNode?: boolean
}
