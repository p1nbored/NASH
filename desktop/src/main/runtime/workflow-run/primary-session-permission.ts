import {
  PRIMARY_PERMISSION_MODES,
  PRIMARY_SESSION_ACCESS_VALUES,
  primarySessionOk,
  primarySessionRefused,
  type PrimaryPermissionMode,
  type PrimarySessionAccess,
  type PrimarySessionRefusal,
  type PrimarySessionResult
} from './primary-session-types'

const MODE_BY_ACCESS: Readonly<Record<PrimarySessionAccess, PrimaryPermissionMode>> = {
  read_only: 'manual',
  workspace_write: 'acceptEdits'
}

// Why: no argument the app builds may name a bypass or auto-approve mode, in any spelling or case.
const FORBIDDEN_TEXT = /dangerously|bypass|dontask/i
const PERMISSION_MODE_FLAG = '--permission-mode'
const ALLOWED_FLAGS: ReadonlySet<string> = new Set([
  PERMISSION_MODE_FLAG,
  '--settings',
  '--agents',
  '--model',
  '--effort'
])
const SNIPPET_MAX = 40

function isPrimarySessionAccess(value: unknown): value is PrimarySessionAccess {
  return PRIMARY_SESSION_ACCESS_VALUES.some((access) => access === value)
}

function isPrimaryPermissionMode(value: unknown): value is PrimaryPermissionMode {
  return PRIMARY_PERMISSION_MODES.some((mode) => mode === value)
}

function snippet(token: string): string {
  return token.length > SNIPPET_MAX ? `${token.slice(0, SNIPPET_MAX)}...` : token
}

function forbidden(detail: string): PrimarySessionRefusal {
  return { code: 'autopilot_session_forbidden_arg', detail }
}

/** read_only starts in manual mode and workspace_write in acceptEdits; nothing else is reachable. */
export function resolvePrimaryPermissionMode(
  access: unknown
): PrimarySessionResult<PrimaryPermissionMode> {
  if (!isPrimarySessionAccess(access)) {
    return primarySessionRefused(
      'autopilot_session_posture_invalid',
      'The requested access must be read_only or workspace_write.'
    )
  }
  return primarySessionOk(MODE_BY_ACCESS[access])
}

/** The Claude Code arguments of a primary session, as an argument vector (no shell quoting). */
export function buildPrimarySessionArgv(args: {
  readonly mode: PrimaryPermissionMode
  readonly settingsFilePath: string
  readonly agentsJson: string | null
}): readonly string[] {
  return [
    PERMISSION_MODE_FLAG,
    args.mode,
    '--settings',
    args.settingsFilePath,
    ...(args.agentsJson === null ? [] : ['--agents', args.agentsJson])
  ]
}

function checkFlagPair(flag: string, value: string | undefined): PrimarySessionRefusal | null {
  if (!ALLOWED_FLAGS.has(flag)) {
    return forbidden(`The argument ${snippet(flag)} is not one the app may pass.`)
  }
  if (value === undefined) {
    return forbidden(`The argument ${flag} has no value.`)
  }
  if (flag === PERMISSION_MODE_FLAG && !isPrimaryPermissionMode(value)) {
    return forbidden('The permission mode must be manual or acceptEdits.')
  }
  return null
}

/**
 * Accepts only the flag and value pairs the app builds, with exactly one allowed permission mode.
 * A strict allowlist rather than a deny list, so a spelling nobody listed cannot slip through.
 */
export function checkPrimaryArgvSafety(
  argv: readonly string[]
): PrimarySessionResult<readonly string[]> {
  const bad = argv.find((token) => FORBIDDEN_TEXT.test(token))
  if (bad !== undefined) {
    return primarySessionRefused(
      'autopilot_session_forbidden_arg',
      `The argument ${snippet(bad)} names a bypass or auto-approve mode.`
    )
  }
  let modeCount = 0
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const refusal = checkFlagPair(flag, argv[index + 1])
    if (refusal) {
      return { ok: false, refusal }
    }
    modeCount += flag === PERMISSION_MODE_FLAG ? 1 : 0
  }
  if (modeCount !== 1) {
    return primarySessionRefused(
      'autopilot_session_forbidden_arg',
      'The arguments must name exactly one permission mode.'
    )
  }
  return primarySessionOk(argv)
}

// The quote and equals forms cover how the startup plan, a shell and a user can spell the flag.
const MODE_VALUE = /--permission-mode["']?(?:\s*=\s*|\s+)["']?([A-Za-z]*)/g

/** The same rules for text: a quoted launch command, or an agentArgs string. Null means it is safe. */
export function findForbiddenPermissionText(text: string): PrimarySessionRefusal | null {
  if (FORBIDDEN_TEXT.test(text)) {
    return forbidden('The command names a bypass or auto-approve mode.')
  }
  const occurrences = text.split(PERMISSION_MODE_FLAG).length - 1
  const values = [...text.matchAll(MODE_VALUE)].map((match) => match[1])
  if (occurrences !== 1 || values.length !== 1 || !isPrimaryPermissionMode(values[0])) {
    return forbidden('The command must carry exactly one allowed --permission-mode.')
  }
  return null
}
