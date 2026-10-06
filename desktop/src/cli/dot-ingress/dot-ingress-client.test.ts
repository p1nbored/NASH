import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { RuntimeClientError } from '../runtime/types'
import { createDotIngressClient, DOT_CLI_LONG_TIMEOUT_MS } from './dot-ingress-client'
import { readDotIngressMetadata } from './dot-ingress-metadata-reader'

// FIXTURE_ONLY: the token, ids and endpoint below are synthetic and open nothing.
const FIXTURE_TOKEN = '0123456789abcdef'.repeat(4)
const FIXTURE_ENDPOINT = '\\\\.\\pipe\\orca-4242-fixture-dot'
const METADATA_FILE = {
  schemaVersion: 1,
  runtimeId: 'runtime-fixture-1',
  pid: 4242,
  startedAt: 1,
  contractVersions: [1],
  transport: { kind: 'named-pipe', endpoint: FIXTURE_ENDPOINT },
  ingressToken: FIXTURE_TOKEN
}
const METADATA: RuntimeMetadata = {
  runtimeId: 'runtime-fixture-1',
  pid: 4242,
  startedAt: 1,
  authToken: FIXTURE_TOKEN,
  transports: [{ kind: 'named-pipe', endpoint: FIXTURE_ENDPOINT }]
}

function codeOf(operation: () => unknown): string | null {
  try {
    operation()
    return null
  } catch (error) {
    return error instanceof RuntimeClientError ? error.code : `unexpected: ${String(error)}`
  }
}

describe('dot ingress discovery file reader', () => {
  it('reads the endpoint and token of a running interface from the user data folder', () => {
    const reads: string[] = []
    const metadata = readDotIngressMetadata('/fixture/user-data', (path) => {
      reads.push(path)
      return JSON.stringify(METADATA_FILE)
    })
    expect(reads).toEqual([join('/fixture/user-data', 'dot-ingress-runtime.json')])
    expect(metadata).toEqual(METADATA)
  })

  it('says the interface is off when there is no discovery file, without naming a path', () => {
    let refusal: unknown = null
    try {
      readDotIngressMetadata('/fixture/user-data', () => {
        throw new Error('ENOENT: /fixture/user-data/dot-ingress-runtime.json')
      })
    } catch (error) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(RuntimeClientError)
    expect(refusal).toMatchObject({ code: 'dot_ingress_disabled' })
    expect(String(refusal)).not.toContain('fixture')
  })

  it.each([
    ['malformed JSON', '{'],
    ['a newer file version', JSON.stringify({ ...METADATA_FILE, schemaVersion: 2 })],
    ['a token of the wrong shape', JSON.stringify({ ...METADATA_FILE, ingressToken: 'short' })],
    [
      'an endpoint that is not the dot one',
      JSON.stringify({
        ...METADATA_FILE,
        transport: { kind: 'named-pipe', endpoint: '\\\\.\\pipe\\orca-4242-fixture' }
      })
    ]
  ])('refuses %s as unavailable', (_name, text) => {
    expect(codeOf(() => readDotIngressMetadata('/fixture/user-data', () => text))).toBe(
      'runtime_unavailable'
    )
  })
})

describe('dot ingress client', () => {
  function sender(result: unknown) {
    return vi.fn(async () => ({ id: 'r1', ok: true as const, result, _meta: { runtimeId: 'x' } }))
  }

  it('speaks contract version 3 and checks every result against the contract', async () => {
    const hello = {
      contractVersion: 3,
      supportedContractVersions: [1, 2, 3],
      methods: ['dotIngress.hello', 'dotIngress.validations.list'],
      limits: {
        maxObjectiveChars: 12_000,
        maxProseChars: 2_000,
        listMaxLimit: 100,
        maxSubmissionsPerMinute: 6,
        maxSubmissionsPerUtcDay: 100,
        maxDecisionSummaryChars: 500,
        maxMessageChars: 4_000,
        maxValidationTitleChars: 200,
        maxValidationSummaryChars: 500
      },
      capabilities: {
        startsWithoutConfirmation: true,
        results: false,
        artifacts: false,
        validationDecisions: true
      }
    }
    const send = sender(hello)
    const client = createDotIngressClient(METADATA, send)

    expect(await client.hello()).toEqual(hello)
    expect(send).toHaveBeenCalledWith(METADATA, 'dotIngress.hello', { contractVersion: 3 }, 30_000)
  })

  it('refuses a result outside the contract instead of printing it', async () => {
    const client = createDotIngressClient(METADATA, sender({ contractVersion: 3, workspaces: 'x' }))
    await expect(client.workspaces()).rejects.toMatchObject({ code: 'invalid_runtime_response' })
  })

  it('lists and decides validation decisions in version 3, checking each result', async () => {
    const list = sender({ contractVersion: 3, validations: [], hasMore: false })
    expect(await createDotIngressClient(METADATA, list).validations({ limit: 3 })).toEqual({
      contractVersion: 3,
      validations: [],
      hasMore: false
    })
    expect(list).toHaveBeenCalledWith(
      METADATA,
      'dotIngress.validations.list',
      { contractVersion: 3, limit: 3 },
      30_000
    )
    const wrong = sender({ contractVersion: 3, outcome: 'decided' })
    await expect(
      createDotIngressClient(METADATA, wrong).decideValidation({
        decisionId: '00000000-0000-4000-8000-000000000009',
        validationId: 'validation_fixture_1',
        decision: 'waive'
      })
    ).rejects.toMatchObject({ code: 'invalid_runtime_response' })
  })

  it('surfaces a refusal with its contract code, message and data', async () => {
    const send = vi.fn(async () => ({
      id: 'r1',
      ok: false as const,
      error: { code: 'dot_rate_limited', message: 'Limit.', data: { window: 'minute' } }
    }))
    const client = createDotIngressClient(METADATA, send)
    await expect(
      client.submit({
        workspaceRef: `dws_${'a'.repeat(24)}`,
        objective: 'Summarize the issues.',
        idempotencyKey: '00000000-0000-4000-8000-000000000001'
      })
    ).rejects.toMatchObject({ code: 'dot_rate_limited', data: { window: 'minute' } })
    expect(send).toHaveBeenCalledWith(
      METADATA,
      'dotIngress.requests.submit',
      expect.any(Object),
      DOT_CLI_LONG_TIMEOUT_MS
    )
  })
})
