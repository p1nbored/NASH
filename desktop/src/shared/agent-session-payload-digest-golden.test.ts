import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalAgentSessionDigest,
  computeAgentSessionPayloadFingerprint
} from './agent-session-mutation-envelope'
import { structuredAgentSessionPayloadFingerprint } from './structured-agent-session-mutation'

// Why absolute digests: both peers hash the same canonical text, so any serializer change
// breaks idempotent replay between an old client and a new host, and shows up here first.
const GOLDEN_DIGESTS: readonly (readonly [string, Record<string, unknown>, string])[] = [
  [
    'nested keys sorted at every depth',
    { b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } },
    '81b0f5bcdfea9246b435fd44e17e57020799f0ff97921832cd006f117a58f04e'
  ],
  [
    'integer-like keys sort as strings and undefined fields drop',
    { '9': 2, '10': 1, b: undefined },
    '616552edfd5a183bdce250113b15ed494216894acf4234431e9eef6a1eb9675a'
  ],
  [
    'mixed-case and non-ASCII keys sort by code unit',
    { a: 1, A: 2, é: 3, 中: 4 },
    'ce44cdd130db3527cb7111d468207d1def3214a761c75d41691e57381458208e'
  ],
  [
    'undefined, NaN and negative zero inside arrays',
    { list: [undefined, Number.NaN, -0, 'quote"slash\\line\n'], flag: true, none: null },
    '035277e9e7992e539ca3566e9f25793db68a4cdeae56189343ac7a0e4d5daecb'
  ],
  [
    'a lone surrogate and an astral character',
    { text: '\ud800', emoji: '\u{1F600}' },
    '614950998d0b5acd182235381741fd9d7eb9c6d5303644b27adce3c5188a0687'
  ]
]

const FINGERPRINT_INPUT = {
  method: 'agentSession.send',
  sessionId: 'session-1',
  fields: { a: 1, A: 2, é: 3, 中: 4, body: { role: 'user', kind: 'message' }, omitted: undefined }
}
const FINGERPRINT_DIGEST = '6e09380d3a51b5005a137c7703b121ed769acc4ce3ad96149b2d0a550d7b9ac0'

describe('agent session payload digests (golden)', () => {
  it.each(GOLDEN_DIGESTS)('keeps the host digest for %s', (_label, value, digest) => {
    expect(canonicalAgentSessionDigest(value)).toBe(digest)
  })

  it('hashes the canonical text with sha256 over UTF-8', () => {
    const text = '{"A":2,"a":1,"é":3,"中":4}'
    expect(canonicalAgentSessionDigest({ a: 1, A: 2, é: 3, 中: 4 })).toBe(
      createHash('sha256').update(text, 'utf8').digest('hex')
    )
  })

  it('keeps the host and the client payload fingerprints identical to the pinned value', () => {
    expect(computeAgentSessionPayloadFingerprint(FINGERPRINT_INPUT)).toBe(FINGERPRINT_DIGEST)
    expect(structuredAgentSessionPayloadFingerprint(FINGERPRINT_INPUT)).toBe(FINGERPRINT_DIGEST)
  })
})
