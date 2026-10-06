import { BoundedMap } from '../../../shared/bounded-map'
import { computeClassificationFingerprint } from '../../clef/clef-classification-fingerprint'
import { CLEF_BODY_MODEL, CLEF_MODEL_PATH, CLEF_URL_TEMPLATE } from '../../clef/clef-endpoint'
import { CLEF_QUESTION_BUNDLE_SHA256 } from '../../clef/clef-question-set'
import type { BuiltClefRequest } from '../../clef/clef-request-builder'
import type { ClefVerifiedProfileRecord } from '../../clef/clef-verified-profile'
import type { CachedClassification, ClassificationCache } from './classification-ports'
import { NO_CALL, type ClassificationEvidence, type Recordable } from './classification-record'

export const CLASSIFICATION_CACHE_MAX_ENTRIES = 256

/** The cache key, or null while no response model is pinned (nothing may be cached then). */
export function classificationFingerprintFor(
  request: Pick<BuiltClefRequest, 'stateSha256'>,
  profile: ClefVerifiedProfileRecord
): string | null {
  const expectedResponseModel = profile.profile.expectedResponseModel
  if (expectedResponseModel === null) {
    return null
  }
  return computeClassificationFingerprint({
    urlTemplate: CLEF_URL_TEMPLATE,
    modelPath: CLEF_MODEL_PATH,
    bodyModel: CLEF_BODY_MODEL,
    expectedResponseModel,
    verifiedProfileHash: profile.profileHash,
    questionBundleSha256: CLEF_QUESTION_BUNDLE_SHA256,
    stateHash: request.stateSha256
  })
}

/** In memory only: a restart forgets every entry, so a cached answer is never older than this process. */
export function createClassificationCache(
  maxEntries: number = CLASSIFICATION_CACHE_MAX_ENTRIES
): ClassificationCache {
  // Why: a count-bounded LRU whose get() touches recency; it throws on a bound below one.
  const entries = new BoundedMap<string, CachedClassification>({ maxEntries })
  return {
    lookup: (fingerprint) => entries.get(fingerprint) ?? null,
    remember(fingerprint, entry) {
      entries.set(fingerprint, Object.freeze({ ...entry }))
    },
    size: () => entries.size
  }
}

/** A hit: the earlier answers with no call and no spend; the route is still looked up afresh. */
export function cachedRecordable(
  cached: CachedClassification,
  evidence: ClassificationEvidence
): Recordable {
  return {
    body: {
      kind: 'classified',
      result: cached.result,
      answers: cached.answers,
      cacheSource: cached.sourceClassificationId
    },
    evidence,
    call: NO_CALL
  }
}
