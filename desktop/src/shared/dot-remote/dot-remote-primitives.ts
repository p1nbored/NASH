import { z } from 'zod'
import { isEnglishText } from '../english-text'

// Leaf schemas shared by every hosted envelope. Identifiers are opaque: none can hold a path, a
// platform token or a client label.

export const DotRemoteTimestampSchema = z.iso.datetime({ offset: true })
export const DotRemoteItemIdSchema = z.uuid()
export const DotRemoteEventIdSchema = z.uuid()
export const DotRemoteSha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

/** At least 128 random bits in base64url; a new value on every lease grant. */
export const DotRemoteLeaseNonceSchema = z.string().regex(/^[A-Za-z0-9_-]{22,86}$/)
/** Pairing generation: starts at 1 and grows on every revocation; fences sessions, leases, acks and events. */
export const DotRemoteGenerationSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
/** Monotonic per dot request: a lower or equal revision than the one applied is stale. */
export const DotRemoteSourceRevisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

export const DotRemoteArtifactIdSchema = z.string().regex(/^art_[0-9a-f]{24}$/)
/** Issued by the Site when a pairing challenge is created, never chosen by the client. */
export const DotRemoteDeviceIdSchema = z.string().regex(/^dev_[0-9a-f]{24}$/)
/** The platform user id as the Site reads it from the identity header; opaque printable ASCII. */
export const DotRemoteOwnerIdSchema = z.string().regex(/^[\x21-\x7E]{1,256}$/)
/** The dot caller, derived on the Site from the verified identity on MCP calls, never from a label. */
export const DotRemoteDotIdentitySchema = z
  .object({ source: z.literal('sites_mcp_identity'), subject: DotRemoteOwnerIdSchema })
  .strict()
export const DotRemoteAppVersionSchema = z.string().regex(/^[A-Za-z0-9._+-]{1,32}$/)
export const DotRemoteCursorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)

/** One line of English with no control or line-separator character, at most `maxChars` long. */
export function dotRemoteEnglishLine(maxChars: number, description: string) {
  return z
    .string()
    .min(1)
    .max(maxChars)
    .regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u)
    .refine(isEnglishText, 'Must be English text')
    .describe(description)
}
