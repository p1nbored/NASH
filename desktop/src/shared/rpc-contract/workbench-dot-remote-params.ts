import { z } from 'zod'
import { DotRemoteUserCodeSchema } from '../dot-remote/dot-remote-pairing'
import {
  DotRemoteDeviceIdSchema,
  DotRemoteGenerationSchema
} from '../dot-remote/dot-remote-primitives'

// The desktop side of remote access (R1): the remote switch, the Site origin and its service token,
// pairing and revocation. Only the trusted desktop caller reaches it. The service token is
// write-only: no result, view or error ever carries it back.

export const DOT_REMOTE_CONNECTION_STATES = [
  'off',
  'unpaired',
  'pairing',
  'connected',
  'offline',
  'reconnect_needed',
  /** The pairing ended on the Site or on the PC; only a new pairing resumes remote access. */
  'pair_again'
] as const
export type DotRemoteConnectionState = (typeof DOT_REMOTE_CONNECTION_STATES)[number]

/** reconnect_needed: the Site token is missing or refused; pasting a current token resumes. */
export const DOT_REMOTE_TOKEN_RECONNECT_REASONS = [
  'service_token_missing',
  'service_token_rejected'
] as const

/** pair_again: the pairing is fenced on the PC and its device credential deleted. */
export const DOT_REMOTE_PAIR_AGAIN_REASONS = [
  'session_rejected',
  'session_expired',
  'session_ended',
  'pairing_revoked',
  'pairing_expired',
  'device_credential_reused',
  'device_credential_invalid',
  'device_credential_unsaved'
] as const

/** Why polling stopped; it stays stopped until the user acts. */
export const DOT_REMOTE_RECONNECT_REASONS = [
  ...DOT_REMOTE_TOKEN_RECONNECT_REASONS,
  ...DOT_REMOTE_PAIR_AGAIN_REASONS
] as const
export type DotRemoteReconnectReason = (typeof DOT_REMOTE_RECONNECT_REASONS)[number]
export type DotRemotePairAgainReason = (typeof DOT_REMOTE_PAIR_AGAIN_REASONS)[number]
export type DotRemoteTokenReconnectReason = (typeof DOT_REMOTE_TOKEN_RECONNECT_REASONS)[number]

const TOKEN_REASONS: ReadonlySet<string> = new Set(DOT_REMOTE_TOKEN_RECONNECT_REASONS)

/** The state a stop reason puts the view in. */
export function dotRemoteStateOfReason(
  reason: DotRemoteReconnectReason
): 'reconnect_needed' | 'pair_again' {
  return TOKEN_REASONS.has(reason) ? 'reconnect_needed' : 'pair_again'
}

export const DOT_REMOTE_TOKEN_PROTECTIONS = [
  'absent',
  'sealed',
  'plaintext_refused',
  'sealing_unavailable'
] as const

export const DOT_REMOTE_PAIRING_STATES = [
  'idle',
  'waiting_for_approval',
  'paired',
  'denied',
  'expired',
  'failed'
] as const

/** Codes of the workbench.dotRemote.* methods; each passes through the RPC error map with its data. */
export const DOT_REMOTE_RPC_ERROR_CODES = {
  unavailable: 'dot_remote_unavailable',
  disabled: 'dot_remote_disabled',
  notConfigured: 'dot_remote_not_configured',
  originInvalid: 'dot_remote_origin_invalid',
  tokenInvalid: 'dot_remote_token_invalid',
  sealingUnavailable: 'dot_remote_sealing_unavailable',
  credentialWriteFailed: 'dot_remote_credential_write_failed',
  siteUnreachable: 'dot_remote_site_unreachable',
  reconnectNeeded: 'dot_remote_reconnect_needed',
  pairingRefused: 'dot_remote_pairing_refused'
} as const

export const DOT_REMOTE_ORIGIN_MAX_CHARS = 2048
export const DOT_REMOTE_SERVICE_TOKEN_MAX_CHARS = 4096

/** Shape checks run in the main process and answer with a code; neither value is ever echoed. */
export const WorkbenchDotRemoteSetConnectionParams = z
  .object({
    origin: z.string().min(1).max(DOT_REMOTE_ORIGIN_MAX_CHARS),
    serviceToken: z.string().min(1).max(DOT_REMOTE_SERVICE_TOKEN_MAX_CHARS)
  })
  .strict()

const TimestampSchema = z.iso.datetime({ offset: true })

/** Polls that threw in a row: a count, the last code as the agent logs it (never a message) and since when. */
export const WorkbenchDotRemoteSyncFailureSchema = z
  .object({
    consecutiveFailures: z.number().int().min(1),
    lastCode: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
    since: TimestampSchema
  })
  .strict()
export type WorkbenchDotRemoteSyncFailure = z.infer<typeof WorkbenchDotRemoteSyncFailureSchema>

export const WorkbenchDotRemoteStatusViewSchema = z
  .object({
    state: z.enum(DOT_REMOTE_CONNECTION_STATES),
    /** The remote switch; off by default and separate from the local dot switch. */
    enabled: z.boolean(),
    origin: z.string().max(DOT_REMOTE_ORIGIN_MAX_CHARS).nullable(),
    /** Presence and protection of the sealed service token, never its value. */
    serviceToken: z.enum(DOT_REMOTE_TOKEN_PROTECTIONS),
    reconnectReason: z.enum(DOT_REMOTE_RECONNECT_REASONS).nullable(),
    pairing: z
      .object({
        deviceId: DotRemoteDeviceIdSchema,
        generation: DotRemoteGenerationSchema,
        pairedAt: TimestampSchema,
        /** The pairing's absolute end on the Site; after it the owner pairs again. */
        pairedUntil: TimestampSchema.nullable().optional()
      })
      .strict()
      .nullable(),
    /** Whether NASH's own dot endpoint listens; remote items wait while it does not. */
    localEndpoint: z.enum(['ready', 'unavailable']),
    lastSyncAt: TimestampSchema.nullable(),
    pendingEvents: z.number().int().min(0),
    /** Set while polls keep throwing, which leaves the state reading connected; null after one does not. */
    syncFailure: WorkbenchDotRemoteSyncFailureSchema.nullable().optional()
  })
  .strict()
  .refine(
    (view) =>
      view.reconnectReason === null
        ? view.state !== 'reconnect_needed' && view.state !== 'pair_again'
        : view.state === dotRemoteStateOfReason(view.reconnectReason),
    {
      message: 'A stop reason belongs to the reconnect_needed or pair_again state it names',
      path: ['reconnectReason']
    }
  )

export const WorkbenchDotRemotePairingViewSchema = z
  .object({
    state: z.enum(DOT_REMOTE_PAIRING_STATES),
    /** Shown to the user, who approves it on the Site while signed in; not a secret. */
    userCode: DotRemoteUserCodeSchema.nullable(),
    expiresAt: TimestampSchema.nullable()
  })
  .strict()
  .refine((view) => (view.state === 'waiting_for_approval') === (view.userCode !== null), {
    message: 'A user code is shown only while the pairing waits for approval',
    path: ['userCode']
  })

export const WorkbenchDotRemotePairingStartResultSchema = z
  .object({
    pairing: WorkbenchDotRemotePairingViewSchema,
    status: WorkbenchDotRemoteStatusViewSchema
  })
  .strict()

export const WorkbenchDotRemoteRevokeResultSchema = z
  .object({
    /** False when the Site could not be told; the pairing is fenced on the PC either way. */
    siteConfirmed: z.boolean(),
    status: WorkbenchDotRemoteStatusViewSchema
  })
  .strict()

export type WorkbenchDotRemoteStatusView = z.infer<typeof WorkbenchDotRemoteStatusViewSchema>
export type WorkbenchDotRemotePairingView = z.infer<typeof WorkbenchDotRemotePairingViewSchema>
export type WorkbenchDotRemotePairingStartResult = z.infer<
  typeof WorkbenchDotRemotePairingStartResultSchema
>
export type WorkbenchDotRemoteRevokeResult = z.infer<typeof WorkbenchDotRemoteRevokeResultSchema>
