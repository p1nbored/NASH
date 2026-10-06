import { z } from 'zod'
import {
  DotRemoteDeviceIdSchema,
  DotRemoteDotIdentitySchema,
  DotRemoteGenerationSchema,
  DotRemoteOwnerIdSchema,
  DotRemoteSha256Schema,
  DotRemoteTimestampSchema
} from './dot-remote-primitives'

// The long-lived device credential of a pairing, like the refresh token of a device-code flow. It lets
// NASH get a new 15-minute session after a restart without asking the owner again. It rotates on
// every refresh, a reused old one revokes the pairing, and the pairing ends after a fixed lifetime.

/** The device credential travels only in this header, next to OAI-Sites-Authorization; never in a body. */
export const DOT_REMOTE_DEVICE_CREDENTIAL_HEADER = 'Nash-Device-Credential'

/** Opaque id the Site looks the stored hash up by; it is the part before the dot. */
export const DotRemoteDeviceCredentialIdSchema = z.string().regex(/^ndc_[0-9a-f]{24}$/)

/** `<credentialId>.<secret>`: the secret holds at least 256 random bits in base64url. */
export const DotRemoteDeviceCredentialSchema = z
  .string()
  .regex(/^ndc_[0-9a-f]{24}\.[A-Za-z0-9_-]{43,86}$/)

/** Shown once, in the response that issues it; expiresAt is the absolute end of the pairing. */
export const DotRemoteDeviceCredentialGrantSchema = z
  .object({ credential: DotRemoteDeviceCredentialSchema, expiresAt: DotRemoteTimestampSchema })
  .strict()

/**
 * What the Site stores per credential: a random salt and secretHash, the lowercase hex SHA-256 of the
 * UTF-8 bytes of salt + "." + secret, bound to the binding it was issued for. The secret is never stored.
 */
export const DotRemoteDeviceCredentialRecordSchema = z
  .object({
    credentialId: DotRemoteDeviceCredentialIdSchema,
    salt: z.string().regex(/^[A-Za-z0-9_-]{22,86}$/),
    secretHash: DotRemoteSha256Schema,
    ownerId: DotRemoteOwnerIdSchema,
    deviceId: DotRemoteDeviceIdSchema,
    dotIdentity: DotRemoteDotIdentitySchema,
    generation: DotRemoteGenerationSchema,
    issuedAt: DotRemoteTimestampSchema,
    /** The pairing's absolute end; every rotated credential keeps the first one's value. */
    lifetimeEndsAt: DotRemoteTimestampSchema,
    /** Set when a refresh replaces it; presenting it afterwards is reuse. */
    supersededAt: DotRemoteTimestampSchema.nullable()
  })
  .strict()

export type DotRemoteDeviceCredentialRecord = z.infer<typeof DotRemoteDeviceCredentialRecordSchema>
