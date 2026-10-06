import { describe, expect, it } from 'vitest'
import { CLEF_QUESTION_BUNDLE_SHA256 } from './clef-question-set'
import {
  CLEF_DOCS_REVISION,
  CLEF_SCHEMA_PINS,
  createPinCheckedProfileSource
} from './clef-schema-pins'
import {
  ClefSchemaPinsSchema,
  clefVerifiedProfileHash,
  type ClefVerifiedProfile,
  type ClefVerifiedProfileRecord
} from './clef-verified-profile'

function profileWith(schemaPins: ClefVerifiedProfile['schemaPins']): ClefVerifiedProfileRecord {
  const profile: ClefVerifiedProfile = {
    profileVersion: 2,
    envelopeMode: 'cf_result_wrapper',
    expectedResponseModel: '@cf/cloudflare/clef',
    optionKeyForm: 'sent_option_id',
    sumTolerance: 1e-3,
    verifiedAt: '2026-10-04T11:00:00.000Z',
    reportSha256: 'a'.repeat(64),
    schemaPins
  }
  return { profile, profileHash: clefVerifiedProfileHash(profile) }
}

describe('clef schema pins', () => {
  it('are well formed and name the documentation revision they were written against', () => {
    expect(ClefSchemaPinsSchema.safeParse(CLEF_SCHEMA_PINS).success).toBe(true)
    expect(CLEF_SCHEMA_PINS.docsRevision).toBe(CLEF_DOCS_REVISION)
  })

  it('pin the input to the question bundle this build sends', () => {
    expect(CLEF_SCHEMA_PINS.inputSchemaSha256).toBe(CLEF_QUESTION_BUNDLE_SHA256)
  })

  // Why absolute: a drift in the contract or the serializer invalidates every pinned profile, and
  // the next verification is a paid call, so the change must be deliberate.
  it('keep the pinned output contract hash unchanged', () => {
    expect(CLEF_SCHEMA_PINS.outputSchemaSha256).toBe(
      'e87330a4009d4089853b6a41df97409919b3105e643fb2c00f4b36510041a4e9'
    )
  })

  // Why: the first Verify must run on the two-question bundle, so no pin of question set 1 may match.
  it('differ from every pin of question set 1, so any v1 verification reads as unverified', () => {
    expect(CLEF_SCHEMA_PINS.inputSchemaSha256).not.toBe(
      '5d54d231d1fb0c9c5e013785bb25f723c6600f579c1c91a5076bd488f2668729'
    )
    expect(CLEF_SCHEMA_PINS.outputSchemaSha256).not.toBe(
      '330ec7f24757adb5233bafbdb5309574cd0cb95cdeca1152dce5861a6a9e5b0a'
    )
  })

  it('keep the output pin apart from the input pin and stable between reads', () => {
    expect(CLEF_SCHEMA_PINS.outputSchemaSha256).not.toBe(CLEF_SCHEMA_PINS.inputSchemaSha256)
    expect(CLEF_SCHEMA_PINS.outputSchemaSha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('pin-checked verified profile source', () => {
  it('returns a profile pinned against this build exactly as stored', () => {
    const record = profileWith(CLEF_SCHEMA_PINS)
    const source = createPinCheckedProfileSource({ read: () => record })
    expect(source.read()).toBe(record)
  })

  it('returns null when nothing is stored', () => {
    expect(createPinCheckedProfileSource({ read: () => null }).read()).toBeNull()
  })

  // Why: a changed question bundle or validation contract means the pinned verification no longer
  // describes what this build sends and accepts, so routing must fall back to contract_unverified.
  it.each([
    ['input schema', { ...CLEF_SCHEMA_PINS, inputSchemaSha256: 'b'.repeat(64) }],
    ['output schema', { ...CLEF_SCHEMA_PINS, outputSchemaSha256: 'c'.repeat(64) }],
    ['documentation revision', { ...CLEF_SCHEMA_PINS, docsRevision: 'older-revision' }]
  ])('treats a profile pinned against a different %s as unverified', (_label, pins) => {
    const source = createPinCheckedProfileSource({ read: () => profileWith(pins) })
    expect(source.read()).toBeNull()
  })

  // Why: list, status and cancel must keep working in an outage, so a locked or unreadable file reads as no profile.
  it('treats a profile file that cannot be read as unverified instead of throwing', () => {
    const source = createPinCheckedProfileSource({
      read: () => {
        throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
      }
    })
    expect(source.read()).toBeNull()
  })

  it('reports an unreadable file once per distinct failure and again after a good read', () => {
    let failure: Error | null = Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
    const record = profileWith(CLEF_SCHEMA_PINS)
    const reported: unknown[] = []
    const source = createPinCheckedProfileSource(
      {
        read: () => {
          if (failure !== null) {
            throw failure
          }
          return record
        }
      },
      CLEF_SCHEMA_PINS,
      (error) => reported.push(error)
    )
    source.read()
    source.read()
    expect(reported).toHaveLength(1)
    failure = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    source.read()
    expect(reported).toHaveLength(2)
    failure = null
    expect(source.read()).toBe(record)
    failure = Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
    source.read()
    expect(reported).toHaveLength(3)
  })

  it('reads the store on every call so a newly pinned profile is seen at once', () => {
    let stored: ClefVerifiedProfileRecord | null = null
    const source = createPinCheckedProfileSource({ read: () => stored })
    expect(source.read()).toBeNull()
    stored = profileWith(CLEF_SCHEMA_PINS)
    expect(source.read()).toBe(stored)
  })
})
