import {
  FetchResponseBodyTooLargeError,
  readFetchResponseBytesWithinLimit
} from '../../shared/fetch-response-body'

/** Matches WORKBENCH_CLEF_RESPONSE_BODY_MAX_BYTES, which the persistence layer enforces; a test pins them together. */
export const CLEF_RESPONSE_BODY_MAX_BYTES = 1_048_576

export type CappedBody = { kind: 'complete'; bytes: Uint8Array } | { kind: 'oversized' }

const OVERSIZED: CappedBody = Object.freeze({ kind: 'oversized' })

/**
 * Reads the body but never holds more than `maxBytes`: a declared length over the cap is refused
 * before any read, and the stream is cancelled at the first byte past it. A read error propagates.
 */
export async function readCappedBody(
  response: Response,
  maxBytes: number = CLEF_RESPONSE_BODY_MAX_BYTES
): Promise<CappedBody> {
  try {
    return { kind: 'complete', bytes: await readFetchResponseBytesWithinLimit(response, maxBytes) }
  } catch (error) {
    if (error instanceof FetchResponseBodyTooLargeError) {
      return OVERSIZED
    }
    throw error
  }
}
