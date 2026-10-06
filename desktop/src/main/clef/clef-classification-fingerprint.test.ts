import { describe, expect, it } from 'vitest'
import {
  computeClassificationFingerprint,
  type ClassificationFingerprintComponents
} from './clef-classification-fingerprint'
import { CLEF_QUESTION_BUNDLE_SHA256 } from './clef-question-set'

const sha = (seed: string): string => seed.repeat(64)

const components: ClassificationFingerprintComponents = {
  urlTemplate:
    'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/cloudflare/clef',
  modelPath: '@cf/cloudflare/clef',
  bodyModel: 'clef',
  expectedResponseModel: '@cf/cloudflare/clef',
  verifiedProfileHash: sha('a'),
  questionBundleSha256: CLEF_QUESTION_BUNDLE_SHA256,
  stateHash: sha('b')
}

const changes: readonly [string, Partial<ClassificationFingerprintComponents>][] = [
  ['urlTemplate', { urlTemplate: `${components.urlTemplate}-v2` }],
  ['modelPath', { modelPath: '@cf/cloudflare/clef-next' }],
  ['bodyModel', { bodyModel: 'clef-next' }],
  ['expectedResponseModel', { expectedResponseModel: '@cf/cloudflare/clef-2' }],
  ['verifiedProfileHash', { verifiedProfileHash: sha('d') }],
  ['questionBundleSha256', { questionBundleSha256: sha('c') }],
  ['stateHash', { stateHash: sha('e') }]
]

describe('classification fingerprint', () => {
  it('is a stable SHA-256 hex digest', () => {
    const fingerprint = computeClassificationFingerprint(components)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(computeClassificationFingerprint({ ...components })).toBe(fingerprint)
  })

  it('does not depend on property order', () => {
    const { stateHash, ...rest } = components
    const reordered: ClassificationFingerprintComponents = { stateHash, ...rest }
    expect(Object.keys(reordered)[0]).toBe('stateHash')
    expect(computeClassificationFingerprint(reordered)).toBe(
      computeClassificationFingerprint(components)
    )
  })

  it.each(changes)('misses when %s changes', (_name, change) => {
    expect(computeClassificationFingerprint({ ...components, ...change })).not.toBe(
      computeClassificationFingerprint(components)
    )
  })

  it('keys on the bundle hash instead of per-field versions, tuples or route options', () => {
    expect(Object.keys(components).toSorted()).toEqual(
      [
        'bodyModel',
        'expectedResponseModel',
        'modelPath',
        'questionBundleSha256',
        'stateHash',
        'urlTemplate',
        'verifiedProfileHash'
      ].toSorted()
    )
  })

  it('ignores extra properties on the caller object, so only named components enter the key', () => {
    const noisy = { ...components, legalSetHash: sha('f'), eligibleTupleIds: ['a'] }
    expect(computeClassificationFingerprint(noisy)).toBe(
      computeClassificationFingerprint(components)
    )
  })
})
