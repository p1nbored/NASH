import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalJson } from '../../shared/canonical-json'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import {
  CLEF_DEFAULT_SUM_TOLERANCE,
  ClefVerifiedProfileSchema,
  clefCanonicalSha256,
  clefVerifiedProfileHash,
  createClefVerifiedProfileFileStore,
  createNodeClefVerifiedProfileFs,
  type ClefVerifiedProfile,
  type ClefVerifiedProfileFs
} from './clef-verified-profile'

// Why a spy over the real writer: the node round-trip below still writes through it.
vi.mock('../codex-accounts/fs-utils', async (importOriginal) => {
  const actual = await importOriginal<{ writeFileAtomically: typeof writeFileAtomically }>()
  return { ...actual, writeFileAtomically: vi.fn(actual.writeFileAtomically) }
})

const PROFILE_PATH = join('profile-dir', 'clef-verified-profile.json')

const profile: ClefVerifiedProfile = {
  profileVersion: 2,
  envelopeMode: 'cf_result_wrapper',
  expectedResponseModel: '@cf/cloudflare/clef',
  optionKeyForm: 'sent_option_id',
  sumTolerance: CLEF_DEFAULT_SUM_TOLERANCE,
  verifiedAt: '2026-10-04T12:00:00.000Z',
  reportSha256: 'a'.repeat(64),
  schemaPins: {
    inputSchemaSha256: '9f6014fdb6f1d3cc32e1f8d01262b9f137743f0590402940c28f8a45114cb683',
    outputSchemaSha256: 'cd1e3d0ecbfa98b5b888b673ffa52587dbf920a12b3e19233c9be90f37b48865',
    docsRevision: 'ef0b61b412a348cf84e2f54eb821b12130b46164'
  }
}

/** A profile as the first build wrote it: version 1 with the score key form. */
const profileVersion1 = {
  profileVersion: 1,
  envelopeMode: 'cf_result_wrapper',
  expectedResponseModel: '@cf/cloudflare/clef',
  optionKeyForm: 'sent_option_id',
  scoreKeyForm: 'level_index',
  sumTolerance: CLEF_DEFAULT_SUM_TOLERANCE,
  verifiedAt: '2026-10-04T12:00:00.000Z',
  reportSha256: 'a'.repeat(64),
  schemaPins: profile.schemaPins
}

function enoent(): Error {
  return Object.assign(new Error('no such file'), { code: 'ENOENT' })
}

function memoryFs(initial: Record<string, string> = {}) {
  let files: Readonly<Record<string, string>> = { ...initial }
  const calls: string[] = []
  const fs: ClefVerifiedProfileFs = {
    readFile: (path) => {
      calls.push(`read ${path}`)
      if (!Object.hasOwn(files, path)) {
        throw enoent()
      }
      return files[path]
    },
    writeFileAtomically: (path, data) => {
      calls.push(`write-atomic ${path}`)
      files = { ...files, [path]: data }
    }
  }
  return { fs, calls, files: () => files }
}

describe('clef verified profile schema', () => {
  it('accepts a complete profile and an unpinned response model', () => {
    expect(ClefVerifiedProfileSchema.parse(profile)).toEqual(profile)
    expect(
      ClefVerifiedProfileSchema.safeParse({ ...profile, expectedResponseModel: null }).success
    ).toBe(true)
  })

  it('rejects unknown fields, bad modes, tolerances, hashes and pins', () => {
    const invalid: unknown[] = [
      { ...profile, extra: true },
      { ...profile, profileVersion: 1 },
      { ...profile, profileVersion: 3 },
      { ...profile, envelopeMode: 'wrapped' },
      { ...profile, optionKeyForm: 'underscored' },
      { ...profile, scoreKeyForm: 'level_index' },
      { ...profile, sumTolerance: 0 },
      { ...profile, sumTolerance: 0.5 },
      { ...profile, verifiedAt: 'yesterday' },
      { ...profile, reportSha256: 'A'.repeat(64) },
      { ...profile, expectedResponseModel: 'has space' },
      { ...profile, schemaPins: { ...profile.schemaPins, outputSchemaSha256: 'x' } },
      { ...profile, schemaPins: { ...profile.schemaPins, extra: 1 } }
    ]
    for (const candidate of invalid) {
      expect(ClefVerifiedProfileSchema.safeParse(candidate).success).toBe(false)
    }
  })
})

describe('clef verified profile version 2', () => {
  it('is version 2 and carries no score key form', () => {
    expect(ClefVerifiedProfileSchema.parse(profile).profileVersion).toBe(2)
    expect(Object.keys(ClefVerifiedProfileSchema.parse(profile))).not.toContain('scoreKeyForm')
    expect(ClefVerifiedProfileSchema.safeParse(profileVersion1).success).toBe(false)
    expect(
      ClefVerifiedProfileSchema.safeParse({ ...profileVersion1, profileVersion: 2 }).success
    ).toBe(false)
  })

  it('reads a profile file pinned by version 1 as absent, so nothing stays pinned from it', () => {
    const memory = memoryFs({
      [PROFILE_PATH]: `${canonicalJson(profileVersion1)}
`
    })
    const store = createClefVerifiedProfileFileStore({ fs: memory.fs, filePath: PROFILE_PATH })
    expect(store.read()).toBeNull()
  })

  it('refuses to write a version 1 profile', () => {
    const memory = memoryFs()
    const store = createClefVerifiedProfileFileStore({ fs: memory.fs, filePath: PROFILE_PATH })
    // Why Reflect.apply: the typed write refuses a version 1 object at compile time, and this proves the runtime refusal too.
    expect(() => Reflect.apply(store.write, store, [profileVersion1])).toThrow(
      /Invalid Clef verified/
    )
    expect(memory.calls).toEqual([])
  })
})

describe('clef canonical hash', () => {
  it('hashes independent of key order', () => {
    expect(clefCanonicalSha256({ b: 1, a: 2 })).toBe(clefCanonicalSha256({ a: 2, b: 1 }))
  })

  // Why absolute: the profile hash is stored in every decision and the profile file, so a
  // serializer change would orphan the pinned profile and force a paid re-verification.
  it('keeps the pinned hash of the fixture profile unchanged', () => {
    expect(clefVerifiedProfileHash(profile)).toBe(
      '151e8bf7ca99dddec76d9f062f5b363ce99da4b9e9331ac93a2aaf073fecf5e2'
    )
  })

  it('hashes the profile independent of key order and sensitive to every field', () => {
    const reordered = Object.fromEntries(Object.entries(profile).toReversed())
    expect(Object.keys(reordered)[0]).toBe('schemaPins')
    expect(clefCanonicalSha256(reordered)).toBe(clefVerifiedProfileHash(profile))
    expect(clefVerifiedProfileHash(profile)).toMatch(/^[0-9a-f]{64}$/)
    expect(clefVerifiedProfileHash({ ...profile, sumTolerance: 5e-3 })).not.toBe(
      clefVerifiedProfileHash(profile)
    )
    expect(clefVerifiedProfileHash({ ...profile, envelopeMode: 'bare' })).not.toBe(
      clefVerifiedProfileHash(profile)
    )
  })
})

describe('clef verified profile file store', () => {
  it('writes the canonical profile and a newline in one atomic write', () => {
    const memory = memoryFs()
    const store = createClefVerifiedProfileFileStore({ fs: memory.fs, filePath: PROFILE_PATH })
    const record = store.write(profile)
    expect(memory.calls).toEqual([`write-atomic ${PROFILE_PATH}`])
    expect(memory.files()).toEqual({ [PROFILE_PATH]: `${canonicalJson(profile)}\n` })
    expect(record).toEqual({ profile, profileHash: clefVerifiedProfileHash(profile) })
    expect(store.read()).toEqual(record)
  })

  it('refuses to write an invalid profile', () => {
    const memory = memoryFs()
    const store = createClefVerifiedProfileFileStore({ fs: memory.fs, filePath: PROFILE_PATH })
    expect(() => store.write({ ...profile, sumTolerance: -1 })).toThrow(/Invalid Clef verified/)
    expect(memory.calls).toEqual([])
  })

  it('rethrows when the atomic write fails and stores nothing', () => {
    const memory = memoryFs()
    const store = createClefVerifiedProfileFileStore({
      fs: {
        ...memory.fs,
        writeFileAtomically: () => {
          throw new Error('disk full')
        }
      },
      filePath: PROFILE_PATH
    })
    expect(() => store.write(profile)).toThrow('disk full')
    expect(memory.files()).toEqual({})
  })

  it('returns null when the file is missing, malformed or fails the schema', () => {
    const contents = [
      null,
      'not json',
      '[]',
      JSON.stringify({ ...profile, extra: 1 }),
      JSON.stringify({ ...profile, envelopeMode: 'other' }),
      `${JSON.stringify(profile)}${' '.repeat(70_000)}`
    ]
    for (const content of contents) {
      const memory = memoryFs(content === null ? {} : { [PROFILE_PATH]: content })
      const store = createClefVerifiedProfileFileStore({ fs: memory.fs, filePath: PROFILE_PATH })
      expect(store.read()).toBeNull()
    }
  })

  it('surfaces read failures other than a missing file', () => {
    const memory = memoryFs()
    const store = createClefVerifiedProfileFileStore({
      fs: {
        ...memory.fs,
        readFile: () => {
          throw Object.assign(new Error('denied'), { code: 'EACCES' })
        }
      },
      filePath: PROFILE_PATH
    })
    expect(() => store.read()).toThrow('denied')
  })
})

describe('node clef verified profile fs', () => {
  let directory: string | null = null

  beforeEach(() => {
    vi.mocked(writeFileAtomically).mockClear()
  })

  afterEach(() => {
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
      directory = null
    }
  })

  it('delegates the write to the shared atomic writer without a mode', () => {
    directory = mkdtempSync(join(tmpdir(), 'clef-profile-'))
    const filePath = join(directory, 'clef-verified-profile.json')
    createNodeClefVerifiedProfileFs().writeFileAtomically(filePath, 'profile text')
    expect(writeFileAtomically).toHaveBeenCalledExactlyOnceWith(filePath, 'profile text')
    expect(readFileSync(filePath, 'utf8')).toBe('profile text')
  })

  it('round-trips a profile on disk without leaving temp files', () => {
    directory = mkdtempSync(join(tmpdir(), 'clef-profile-'))
    const filePath = join(directory, 'clef-verified-profile.json')
    const store = createClefVerifiedProfileFileStore({
      fs: createNodeClefVerifiedProfileFs(),
      filePath
    })
    expect(store.read()).toBeNull()
    store.write(profile)
    store.write({ ...profile, envelopeMode: 'bare' })
    expect(store.read()?.profile.envelopeMode).toBe('bare')
    expect(readdirSync(directory)).toEqual(['clef-verified-profile.json'])
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({ envelopeMode: 'bare' })
    writeFileSync(filePath, 'corrupt')
    expect(store.read()).toBeNull()
  })
})
