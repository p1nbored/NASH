import { z } from 'zod'
import { DotRemoteDeviceCredentialGrantSchema } from './dot-remote-device-credential'
import {
  DotRemoteAppVersionSchema,
  DotRemoteDeviceIdSchema,
  DotRemoteDotIdentitySchema,
  DotRemoteGenerationSchema,
  DotRemoteOwnerIdSchema,
  DotRemoteTimestampSchema
} from './dot-remote-primitives'

// RG4: pairing follows the device-authorization pattern. NASH asks the Site for a short-lived,
// single-use challenge, shows its userCode to the user, and the signed-in owner approves that code on
// the Site. Owner, device, dot identity and generation are derived on the server; no body field,
// client label or known id is authority.

/** The platform service token travels only in this header, on every NASH request (RG3). */
export const DOT_REMOTE_SERVICE_AUTH_HEADER = 'OAI-Sites-Authorization'
/** The app session token travels only in this header; no request body carries it. */
export const DOT_REMOTE_SESSION_HEADER = 'Nash-Session'
/** Read by the Site from the platform for a signed-in user; NASH never sends it. */
export const DOT_REMOTE_OWNER_IDENTITY_HEADER = 'oai-authenticated-user-id'

/** Eight letters without vowels or look-alikes, shown to the user and typed or confirmed on the Site. */
export const DotRemoteUserCodeSchema = z
  .string()
  .regex(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/)
/** At least 256 random bits in base64url, held by the device; the Site stores only its hash. */
export const DotRemoteDeviceCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{43,86}$/)
export const DotRemoteSessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/)
export const DotRemoteChallengeIdSchema = z.uuid()

export const DotRemoteChallengeCreateRequestSchema = z
  .object({ appVersion: DotRemoteAppVersionSchema })
  .strict()

export const DotRemoteChallengeSchema = z
  .object({
    challengeId: DotRemoteChallengeIdSchema,
    userCode: DotRemoteUserCodeSchema,
    deviceCode: DotRemoteDeviceCodeSchema,
    expiresAt: DotRemoteTimestampSchema,
    pollIntervalSeconds: z.number().int().min(1).max(60)
  })
  .strict()

/** Sent by the owner's signed-in browser session; the owner id comes from the identity header. */
export const DotRemotePairingApprovalRequestSchema = z
  .object({ userCode: DotRemoteUserCodeSchema, decision: z.enum(['approve', 'deny']) })
  .strict()

export const DotRemotePairingApprovalResponseSchema = z
  .object({ outcome: z.enum(['approved', 'denied']) })
  .strict()

/** Single use: the first issued session consumes the challenge. */
export const DotRemoteSessionIssueRequestSchema = z
  .object({ challengeId: DotRemoteChallengeIdSchema, deviceCode: DotRemoteDeviceCodeSchema })
  .strict()

export const DotRemoteSessionSchema = z
  .object({
    sessionToken: DotRemoteSessionTokenSchema,
    expiresAt: DotRemoteTimestampSchema,
    renewAfter: DotRemoteTimestampSchema,
    deviceId: DotRemoteDeviceIdSchema,
    generation: DotRemoteGenerationSchema
  })
  .strict()

export const DotRemoteSessionIssueResponseSchema = z.discriminatedUnion('state', [
  z
    .object({ state: z.literal('pending'), pollIntervalSeconds: z.number().int().min(1).max(60) })
    .strict(),
  /** The device credential appears here and in refresh responses only. */
  z
    .object({
      state: z.literal('issued'),
      session: DotRemoteSessionSchema,
      deviceCredential: DotRemoteDeviceCredentialGrantSchema
    })
    .strict()
])

/** The session token is in the session header; the body only asserts the generation it belongs to. */
export const DotRemoteSessionRenewRequestSchema = z
  .object({ generation: DotRemoteGenerationSchema })
  .strict()

export const DotRemoteSessionRenewResponseSchema = z
  .object({ session: DotRemoteSessionSchema })
  .strict()

/** The device credential is in its header; the body only asserts the generation it belongs to. */
export const DotRemoteSessionRefreshRequestSchema = z
  .object({ generation: DotRemoteGenerationSchema })
  .strict()

/** A new session and a new credential; the presented credential is superseded at once. */
export const DotRemoteSessionRefreshResponseSchema = z
  .object({
    session: DotRemoteSessionSchema,
    deviceCredential: DotRemoteDeviceCredentialGrantSchema
  })
  .strict()

export const DotRemoteRevokeRequestSchema = z
  .object({ generation: DotRemoteGenerationSchema })
  .strict()

export const DotRemoteRevokeResponseSchema = z
  .object({ revokedGeneration: DotRemoteGenerationSchema })
  .strict()

/**
 * The Site's stored binding. ownerId comes from the identity header when the owner approves;
 * deviceId and generation from the pairing record; dotIdentity from the verified identity on MCP calls.
 */
export const DotRemotePairingBindingSchema = z
  .object({
    ownerId: DotRemoteOwnerIdSchema,
    deviceId: DotRemoteDeviceIdSchema,
    dotIdentity: DotRemoteDotIdentitySchema,
    generation: DotRemoteGenerationSchema,
    createdAt: DotRemoteTimestampSchema,
    /** createdAt plus deviceCredentialLifetimeDays; after it the owner pairs again. */
    lifetimeEndsAt: DotRemoteTimestampSchema,
    revokedAt: DotRemoteTimestampSchema.nullable()
  })
  .strict()

export type DotRemotePairingBinding = z.infer<typeof DotRemotePairingBindingSchema>
