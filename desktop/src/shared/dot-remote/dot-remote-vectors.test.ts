import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { DOT_REMOTE_SUBMIT_TTL_MINUTES } from './dot-remote-defaults'
import { DOT_REMOTE_ENDPOINTS, dotRemoteEndpointSchemas } from './dot-remote-endpoints'
import { DotRemoteEndpointErrorSchema, DotRemoteToolErrorSchema } from './dot-remote-errors'
import { DOT_REMOTE_LEASE_SECONDS } from './dot-remote-limits'
import { buildDotMcpToolManifest } from './dot-remote-manifest'
import { dotRemoteCanonicalPayload, dotRemotePayloadSha256 } from './dot-remote-payload'
import { DOT_REMOTE_TOOLS } from './dot-remote-tools'
import {
  DOT_REMOTE_REQUIRED_CASES,
  buildDotRemoteConformanceVectors,
  type DotRemoteVector,
  type DotRemoteVectorStep
} from './dot-remote-vectors.test-fixture'

const file = buildDotRemoteConformanceVectors()
const VECTORS: [string, DotRemoteVector][] = file.vectors.map((vector) => [vector.id, vector])
const TTL_MS = DOT_REMOTE_SUBMIT_TTL_MINUTES * 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collect(
  value: unknown,
  match: (node: Record<string, unknown>) => boolean
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((child) => collect(child, match))
  }
  if (!isRecord(value)) {
    return []
  }
  const own = match(value) ? [value] : []
  return [...own, ...Object.values(value).flatMap((child) => collect(child, match))]
}

function stepSchemas(step: DotRemoteVectorStep): {
  input: z.ZodType
  output: z.ZodType
  error: z.ZodType
} {
  if (step.actor === 'dot') {
    const tool = DOT_REMOTE_TOOLS.find((entry) => entry.name === step.tool)
    if (!tool) {
      throw new Error(`Unknown tool ${step.tool}`)
    }
    return { input: tool.input, output: tool.output, error: DotRemoteToolErrorSchema }
  }
  const endpoint = DOT_REMOTE_ENDPOINTS.find((entry) => entry.name === step.endpoint)
  if (!endpoint) {
    throw new Error(`Unknown endpoint ${step.endpoint}`)
  }
  const schemas = dotRemoteEndpointSchemas(endpoint)
  return { input: schemas.request, output: schemas.response, error: DotRemoteEndpointErrorSchema }
}

function stepInput(step: DotRemoteVectorStep): unknown {
  return step.actor === 'dot' ? step.arguments : step.body
}

const isReceipt = (node: Record<string, unknown>) =>
  'itemId' in node && 'state' in node && 'kind' in node
const isLeasedItem = (node: Record<string, unknown>) => 'lease' in node && 'payload' in node

describe('dot remote conformance vectors', () => {
  it('matches the golden vectors file', async () => {
    await expect(`${JSON.stringify(file, null, 2)}\n`).toMatchFileSnapshot(
      './dot-remote-conformance-vectors.json'
    )
  })

  it('binds to the current manifest and contract version', () => {
    expect(file.manifestSha256).toBe(buildDotMcpToolManifest().manifestSha256)
    expect(file.contractVersion).toBe(3)
  })

  it('has one accepted vector per tool', () => {
    const accepted = file.vectors
      .filter((vector) => vector.category === 'accepted')
      .map((vector) => vector.covers)
    expect([...accepted].sort()).toEqual(DOT_REMOTE_TOOLS.map((tool) => tool.name).sort())
  })

  it('covers every required race and error case', () => {
    const ids = file.vectors.map((vector) => vector.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of DOT_REMOTE_REQUIRED_CASES) {
      expect(ids, id).toContain(id)
    }
  })

  it('reproduces every payload hash example', () => {
    expect(file.payloadHashExamples.length).toBeGreaterThanOrEqual(3)
    for (const example of file.payloadHashExamples) {
      expect(dotRemoteCanonicalPayload(example.payload), example.name).toBe(example.canonicalJson)
      expect(dotRemotePayloadSha256(example.payload), example.name).toBe(example.sha256)
    }
  })

  it.each(VECTORS)('%s: every step input and expected output matches its schema', (_id, vector) => {
    for (const [index, step] of vector.steps.entries()) {
      const label = `${vector.id} step ${index + 1}`
      const schemas = stepSchemas(step)
      const invalidInput = 'error' in step.expect && step.expect.error.code === 'payload_invalid'
      expect(schemas.input.safeParse(stepInput(step)).success, label).toBe(!invalidInput)
      const parsed =
        'result' in step.expect
          ? schemas.output.safeParse(step.expect.result)
          : schemas.error.safeParse(step.expect)
      expect(parsed.success, `${label}: ${parsed.error?.message ?? ''}`).toBe(true)
      if (step.actor !== 'dot' && step.itemId !== undefined) {
        expect(isRecord(step.body) && step.body.itemId, label).toBe(step.itemId)
      }
    }
  })

  it.each(VECTORS)(
    '%s: leased items carry the hash of their payload and a 60 s lease',
    (_id, vector) => {
      for (const step of vector.steps) {
        const items = 'result' in step.expect ? collect(step.expect.result, isLeasedItem) : []
        for (const item of items) {
          expect(item.payloadSha256).toBe(dotRemotePayloadSha256(item.payload))
          const lease = isRecord(item.lease) ? item.lease : {}
          expect(Date.parse(String(lease.leaseExpiresAt)) - Date.parse(step.at)).toBe(
            DOT_REMOTE_LEASE_SECONDS * 1000
          )
          expect(vector.generated.leaseNonces).toContain(lease.leaseNonce)
        }
      }
    }
  )

  it.each(VECTORS)('%s: receipts use generated ids and expire after the TTL', (_id, vector) => {
    const receipts = vector.steps.flatMap((step) =>
      'result' in step.expect ? collect(step.expect.result, isReceipt) : []
    )
    for (const receipt of receipts) {
      expect(vector.generated.itemIds).toContain(receipt.itemId)
      const lifetime = Date.parse(String(receipt.expiresAt)) - Date.parse(String(receipt.createdAt))
      // Why: a validation decision has no deadline, so it expires the TTL after the decide call.
      if (receipt.kind === 'permission_answer') {
        expect(lifetime).toBeLessThanOrEqual(TTL_MS)
      } else {
        expect(lifetime).toBe(TTL_MS)
      }
    }
  })

  it('returns the identical receipt for a repeated call with the same key and payload', () => {
    const vector = file.vectors.find((entry) => entry.id === 'race.repeated_call_same_payload')
    const results =
      vector?.steps.filter((step) => step.actor === 'dot').map((step) => step.expect) ?? []
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results[1]).toEqual(results[0])
  })

  it('never lets a payload idempotency key or message id equal an item id', () => {
    for (const vector of file.vectors) {
      const items = vector.steps.flatMap((step) =>
        'result' in step.expect ? collect(step.expect.result, isLeasedItem) : []
      )
      for (const item of items) {
        const payload = isRecord(item.payload) ? item.payload : {}
        const keys = [payload.idempotencyKey, payload.messageId]
        if (item.kind === 'validation_decision') {
          keys.push(payload.decisionId)
        }
        expect(keys, vector.id).not.toContain(item.itemId)
      }
    }
  })
})

const PAIRING_CASES = [
  'pairing.refresh_ok',
  'pairing.refresh_rotation',
  'pairing.refresh_reuse_detected',
  'pairing.refresh_lifetime_expired',
  'pairing.refresh_revoked_generation'
]
const PAIRING: [string, DotRemoteVector][] = VECTORS.filter(([id]) => id.startsWith('pairing.'))
const isGrant = (node: Record<string, unknown>) => 'credential' in node && 'expiresAt' in node
const isSession = (node: Record<string, unknown>) => 'sessionToken' in node

function refreshSteps(vector: DotRemoteVector) {
  return vector.steps.flatMap((step) =>
    step.actor !== 'dot' && step.endpoint === 'pairing.session.refresh' ? [step] : []
  )
}

function presented(step: DotRemoteVectorStep): string {
  return 'deviceCredential' in step.caller ? step.caller.deviceCredential : ''
}

describe('device credential vectors', () => {
  it('covers refresh, rotation, reuse, the absolute lifetime and revocation', () => {
    expect(PAIRING.map(([id]) => id).sort()).toEqual([...PAIRING_CASES].sort())
  })

  it.each(PAIRING)('%s: sends the credential only in its header', (_id, vector) => {
    const steps = refreshSteps(vector)
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) {
      expect(presented(step)).toMatch(/^ndc_/)
      expect(JSON.stringify(step.body)).not.toContain(presented(step))
    }
  })

  it.each(PAIRING)('%s: returns only generated sessions and credentials', (_id, vector) => {
    const generated = vector.generated.pairing
    for (const step of vector.steps) {
      const result = 'result' in step.expect ? step.expect.result : null
      for (const grant of collect(result, isGrant)) {
        expect(generated?.deviceCredentials).toContain(grant.credential)
      }
      for (const session of collect(result, isSession)) {
        expect(generated?.sessionTokens).toContain(session.sessionToken)
      }
    }
  })

  it.each(PAIRING)('%s: rotates on every refresh and never extends the lifetime', (_id, vector) => {
    const grants = vector.steps.flatMap((step) =>
      'result' in step.expect ? collect(step.expect.result, isGrant) : []
    )
    expect(new Set(grants.map((grant) => grant.expiresAt)).size).toBeLessThanOrEqual(1)
    for (const step of refreshSteps(vector)) {
      if ('result' in step.expect) {
        const [grant] = collect(step.expect.result, isGrant)
        const [session] = collect(step.expect.result, isSession)
        expect(grant?.credential).not.toBe(presented(step))
        expect(Date.parse(String(session?.expiresAt))).toBeLessThanOrEqual(
          Date.parse(String(grant?.expiresAt))
        )
      }
    }
  })

  it('treats a rotated credential presented again as theft and revokes the binding', () => {
    const vector = PAIRING.find(([id]) => id === 'pairing.refresh_reuse_detected')?.[1]
    const codes = (vector ? refreshSteps(vector) : []).map((step) =>
      'error' in step.expect ? step.expect.error.code : 'ok'
    )
    expect(codes).toEqual(['ok', 'device_credential_reused', 'generation_revoked'])
  })

  it('refuses a refresh after the absolute lifetime and after a revocation', () => {
    const last = (id: string) => {
      const vector = PAIRING.find(([entry]) => entry === id)?.[1]
      const step = vector ? refreshSteps(vector).at(-1) : undefined
      return step && 'error' in step.expect ? step.expect.error.code : null
    }
    expect(last('pairing.refresh_lifetime_expired')).toBe('pairing_expired')
    expect(last('pairing.refresh_revoked_generation')).toBe('generation_revoked')
  })
})
