import { GLOBAL_FLAGS, type CommandSpec } from '../args'

/**
 * The hidden command the primary session's PermissionRequest hook runs (A3 writes it into the
 * generated settings file). Not registered here: package E1 adds it to COMMAND_SPECS.
 */
export const ORCHESTRATION_PERMISSION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['orchestration', 'permission-request'],
    hidden: true,
    summary: 'Relay a Claude Code PermissionRequest hook to dot and the desktop app',
    usage: 'orca orchestration permission-request',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Not for agents: Claude Code runs it as the PermissionRequest hook and passes the hook JSON on stdin.',
      'Prints the decision JSON when dot or the desktop app answers in time; otherwise prints nothing, so Claude Code shows its own dialog.',
      'Only tool, command and file names leave this process; file contents never do.'
    ]
  }
]
