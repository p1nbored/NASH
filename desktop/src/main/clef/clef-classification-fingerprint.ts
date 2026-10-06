import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'

/** The components of a classification cache key; every one that can change an answer is named. */
export type ClassificationFingerprintComponents = {
  readonly urlTemplate: string
  readonly modelPath: string
  readonly bodyModel: string
  readonly expectedResponseModel: string
  readonly verifiedProfileHash: string
  /** Covers the question order, the option texts, the taxonomy and the thresholds. */
  readonly questionBundleSha256: string
  /** The masked TaskSpec state; verbatim spans never enter it. */
  readonly stateHash: string
}

const CLASSIFICATION_FINGERPRINT_FORMAT = 2

/** Cache key for a classified TaskSpec; any component change is a miss. */
export function computeClassificationFingerprint(
  components: ClassificationFingerprintComponents
): string {
  // Why: copy fields explicitly so extra properties on the caller's object never enter the key.
  return canonicalAgentSessionDigest({
    format: CLASSIFICATION_FINGERPRINT_FORMAT,
    urlTemplate: components.urlTemplate,
    modelPath: components.modelPath,
    bodyModel: components.bodyModel,
    expectedResponseModel: components.expectedResponseModel,
    verifiedProfileHash: components.verifiedProfileHash,
    questionBundleSha256: components.questionBundleSha256,
    stateHash: components.stateHash
  })
}
