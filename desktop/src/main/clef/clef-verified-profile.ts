import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { canonicalJson } from '../../shared/canonical-json'
import { ClefModelLabelSchema } from '../../shared/clef/clef-answers'
import type { ClefProfileProblem } from '../../shared/clef/clef-verification-view'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import type { ClefVerificationReport } from './clef-verification-report'

/**
 * The verified profile pinned after the user confirms a live verification report (spec section 14).
 * Version 2 (D-016) drops the score key form with the score question; a version 1 file fails the
 * schema and so reads as absent, which is free because no live verification ever produced one.
 */

export const CLEF_VERIFIED_PROFILE_FILE_NAME = 'clef-verified-profile.json'
export const CLEF_ENVELOPE_MODES = ['cf_result_wrapper', 'bare'] as const
/** Only an exact echo of the sent option IDs can be pinned. */
export const CLEF_OPTION_KEY_FORMS = ['sent_option_id'] as const
export const CLEF_DEFAULT_SUM_TOLERANCE = 1e-3
const CLEF_MAX_SUM_TOLERANCE = 1e-2
const MAX_PROFILE_FILE_CHARS = 64 * 1024

export type ClefEnvelopeMode = (typeof CLEF_ENVELOPE_MODES)[number]

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/)

export const ClefSchemaPinsSchema = z
  .object({
    inputSchemaSha256: Sha256HexSchema,
    outputSchemaSha256: Sha256HexSchema,
    docsRevision: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
  })
  .strict()
export type ClefSchemaPins = z.infer<typeof ClefSchemaPinsSchema>

export const ClefVerifiedProfileSchema = z
  .object({
    profileVersion: z.literal(2),
    envelopeMode: z.enum(CLEF_ENVELOPE_MODES),
    /** Null keeps the contract verified but the identity unpinned, which still blocks routing. */
    expectedResponseModel: ClefModelLabelSchema.nullable(),
    optionKeyForm: z.enum(CLEF_OPTION_KEY_FORMS),
    sumTolerance: z.number().positive().max(CLEF_MAX_SUM_TOLERANCE),
    verifiedAt: z.iso.datetime({ offset: true }),
    reportSha256: Sha256HexSchema,
    schemaPins: ClefSchemaPinsSchema
  })
  .strict()
export type ClefVerifiedProfile = z.infer<typeof ClefVerifiedProfileSchema>

export type ClefVerifiedProfileRecord = {
  profile: ClefVerifiedProfile
  profileHash: string
}

export function clefCanonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function clefVerifiedProfileHash(profile: ClefVerifiedProfile): string {
  return clefCanonicalSha256(profile)
}

/** Synchronous so routing gates can read the profile inside a write transaction. */
export type ClefVerifiedProfileFs = {
  readFile(path: string): string
  writeFileAtomically(path: string, data: string): void
}

export type ClefVerifiedProfileFileStore = {
  /** Null when the file is missing or fails parsing or the schema; other I/O errors propagate. */
  read(): ClefVerifiedProfileRecord | null
  /** Validates, then replaces the profile file in one atomic write. */
  write(profile: ClefVerifiedProfile): ClefVerifiedProfileRecord
}

export function createNodeClefVerifiedProfileFs(): ClefVerifiedProfileFs {
  return {
    readFile: (path) => readFileSync(path, 'utf8'),
    // Why Orca's writer: it retries the Windows userData EPERM that a bare rename does not.
    writeFileAtomically: (path, data) => writeFileAtomically(path, data)
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function parseProfileText(text: string): ClefVerifiedProfile | null {
  if (text.length > MAX_PROFILE_FILE_CHARS) {
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = ClefVerifiedProfileSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

function recordOf(profile: ClefVerifiedProfile): ClefVerifiedProfileRecord {
  return { profile, profileHash: clefVerifiedProfileHash(profile) }
}

export function createClefVerifiedProfileFileStore(options: {
  fs: ClefVerifiedProfileFs
  filePath: string
}): ClefVerifiedProfileFileStore {
  const { fs, filePath } = options

  return {
    read() {
      let text: string
      try {
        text = fs.readFile(filePath)
      } catch (error) {
        if (isMissingFileError(error)) {
          return null
        }
        throw error
      }
      const profile = parseProfileText(text)
      return profile ? recordOf(profile) : null
    },

    write(profile) {
      const parsed = ClefVerifiedProfileSchema.safeParse(profile)
      if (!parsed.success) {
        throw new Error('Invalid Clef verified profile')
      }
      fs.writeFileAtomically(filePath, `${canonicalJson(parsed.data)}\n`)
      return recordOf(parsed.data)
    }
  }
}

/** Pinning: the report hash and the profile a confirmed report yields. */
export function clefVerificationReportSha256(report: ClefVerificationReport): string {
  return clefCanonicalSha256(report)
}

// Why re-exported: the renderer parses the same problem names, so the list has one owner in src/shared.
export type { ClefProfileProblem }

const HTTP_OK = 200
// Why: phase 1 never routes through clef-flash or any other variant, so such an identity must not be pinned.
const DISALLOWED_MODEL_PATTERN = /flash/i

function envelopeProblem(envelope: ClefVerificationReport['envelope']): ClefProfileProblem | null {
  if (envelope.shape === 'unrecognized') {
    return 'envelope_unrecognized'
  }
  const failed = envelope.success === false || (envelope.errorCount ?? 0) > 0
  return envelope.shape === 'cf_result_wrapper' && failed ? 'envelope_not_successful' : null
}

function profileProblems(report: ClefVerificationReport): ClefProfileProblem[] {
  const checks: [ClefProfileProblem | null, boolean][] = [
    ['http_status', report.httpStatus !== HTTP_OK],
    [envelopeProblem(report.envelope), true],
    ['response_model_unobserved', report.model.observed === null],
    ['response_model_disallowed', DISALLOWED_MODEL_PATTERN.test(report.model.observed ?? '')],
    ['answer_keys_mismatch', !report.answerKeys.matchQuestionIds],
    ['option_ids_not_echoed', report.optionIdEcho !== 'exact'],
    ['probability_out_of_range', report.questions.some((q) => q.valuesInRange === false)],
    [
      'probability_sum_out_of_tolerance',
      (report.maxSumDeviation ?? 0) > CLEF_DEFAULT_SUM_TOLERANCE
    ],
    ['usage_missing', report.usage.inputTokens === null]
  ]
  return checks.flatMap(([problem, failed]) => (problem !== null && failed ? [problem] : []))
}

/** The profile a user may pin after confirming this report; any problem blocks pinning. */
export function clefVerifiedProfileFromReport(
  report: ClefVerificationReport,
  pin: { verifiedAt: string; schemaPins: ClefSchemaPins }
): { ok: true; profile: ClefVerifiedProfile } | { ok: false; problems: ClefProfileProblem[] } {
  const problems = profileProblems(report)
  const { shape } = report.envelope
  if (problems.length > 0 || shape === 'unrecognized') {
    return { ok: false, problems }
  }
  const parsed = ClefVerifiedProfileSchema.safeParse({
    profileVersion: 2,
    envelopeMode: shape,
    expectedResponseModel: report.model.observed,
    optionKeyForm: 'sent_option_id',
    sumTolerance: CLEF_DEFAULT_SUM_TOLERANCE,
    verifiedAt: pin.verifiedAt,
    reportSha256: clefVerificationReportSha256(report),
    schemaPins: pin.schemaPins
  })
  return parsed.success
    ? { ok: true, profile: parsed.data }
    : { ok: false, problems: ['pin_invalid'] }
}
