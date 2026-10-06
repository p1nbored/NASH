import { z } from 'zod'

/**
 * Renderer-safe Clef credential contract shared by main, preload and renderer: channel names,
 * presence, protection and refusal codes. Nothing here can carry a credential value back out.
 */

export const CLEF_CREDENTIAL_CHANNELS = {
  status: 'clef:credentials:status',
  save: 'clef:credentials:save',
  clear: 'clef:credentials:clear'
} as const

export const CLEF_CREDENTIAL_PROTECTIONS = [
  /** Every stored value is sealed by the OS keyring; check the presence flags for completeness. */
  'sealed',
  /** A stored value is plaintext or not provably sealed; it is never read. */
  'plaintext_refused',
  /** The OS keyring cannot seal or unseal right now. */
  'sealing_unavailable',
  /** Nothing is stored. */
  'absent'
] as const
export type ClefCredentialProtection = (typeof CLEF_CREDENTIAL_PROTECTIONS)[number]

export type ClefCredentialStatus = {
  tokenPresent: boolean
  accountPresent: boolean
  protection: ClefCredentialProtection
}

export const CLEF_API_TOKEN_SHAPE_CODES = [
  'token_missing',
  'token_too_short',
  'token_too_long',
  'token_invalid_characters'
] as const
export type ClefApiTokenShapeCode = (typeof CLEF_API_TOKEN_SHAPE_CODES)[number]

export const CLEF_ACCOUNT_ID_SHAPE_CODES = [
  'account_id_missing',
  'account_id_invalid_format'
] as const
export type ClefAccountIdShapeCode = (typeof CLEF_ACCOUNT_ID_SHAPE_CODES)[number]

export type ClefCredentialShapeCode = ClefApiTokenShapeCode | ClefAccountIdShapeCode

export type ClefCredentialSaveRefusal =
  | ClefCredentialShapeCode
  | 'sealing_unavailable'
  | 'write_failed'

export type ClefCredentialClearRefusal = 'clear_failed'

export const CLEF_CREDENTIAL_REFUSAL_CODES = [
  ...CLEF_API_TOKEN_SHAPE_CODES,
  ...CLEF_ACCOUNT_ID_SHAPE_CODES,
  'sealing_unavailable',
  'write_failed',
  'clear_failed'
] as const satisfies readonly (ClefCredentialSaveRefusal | ClefCredentialClearRefusal)[]

/** What save and clear return to the renderer: an outcome code and presence, never values. */
export type ClefCredentialsMutationResult =
  | { ok: true; status: ClefCredentialStatus }
  | {
      ok: false
      code: ClefCredentialSaveRefusal | ClefCredentialClearRefusal
      status: ClefCredentialStatus
    }

/** The only shape in which a token crosses IPC: renderer to main, inside the save call. */
export type ClefCredentialSaveInput = {
  token: string
  accountId: string
}

const ClefCredentialStatusSchema = z
  .object({
    tokenPresent: z.boolean(),
    accountPresent: z.boolean(),
    protection: z.enum(CLEF_CREDENTIAL_PROTECTIONS)
  })
  .strict()

const ClefCredentialsMutationResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), status: ClefCredentialStatusSchema }).strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.enum(CLEF_CREDENTIAL_REFUSAL_CODES),
      status: ClefCredentialStatusSchema
    })
    .strict()
])

/** Null for anything that is not exactly a status (including a web client with no desktop bridge). */
export function parseClefCredentialStatus(value: unknown): ClefCredentialStatus | null {
  const parsed = ClefCredentialStatusSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseClefCredentialsMutationResult(
  value: unknown
): ClefCredentialsMutationResult | null {
  const parsed = ClefCredentialsMutationResultSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
