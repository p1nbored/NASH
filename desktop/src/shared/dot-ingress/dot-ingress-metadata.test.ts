import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOT_INGRESS_METADATA_FILE,
  DotIngressMetadataSchema,
  getDotIngressMetadataPath
} from './dot-ingress-metadata'

// FIXTURE_ONLY: a synthetic 64-hex token that is obviously not a credential.
const FIXTURE_TOKEN = '0123456789abcdef'.repeat(4)

const pipe = {
  schemaVersion: 1,
  runtimeId: 'runtime-fixture-1',
  pid: 4321,
  startedAt: 1_790_000_000_000,
  contractVersions: [1],
  transport: { kind: 'named-pipe', endpoint: '\\\\.\\pipe\\orca-4321-ab12cd-dot' },
  ingressToken: FIXTURE_TOKEN
}
const unix = {
  ...pipe,
  transport: { kind: 'unix', endpoint: '/run/user/1000/o-4321-ab12cd-dot.sock' }
}

describe('dot ingress discovery file', () => {
  it('lives next to the runtime metadata in its own file', () => {
    expect(DOT_INGRESS_METADATA_FILE).toBe('dot-ingress-runtime.json')
    expect(getDotIngressMetadataPath('/data/NASH')).toBe(
      join('/data/NASH', 'dot-ingress-runtime.json')
    )
  })

  it.each([pipe, unix])('accepts a pipe or socket description', (value) => {
    expect(DotIngressMetadataSchema.parse(value)).toEqual(value)
  })

  it('refuses a transport that is not the dedicated ingress endpoint', () => {
    for (const transport of [
      { kind: 'named-pipe', endpoint: '\\\\.\\pipe\\orca-4321-ab12cd' },
      { kind: 'unix', endpoint: '/run/user/1000/o-4321-ab12cd.sock' },
      { kind: 'websocket', endpoint: 'ws://127.0.0.1:1234' },
      { kind: 'unix', endpoint: '' }
    ]) {
      expect(DotIngressMetadataSchema.safeParse({ ...pipe, transport }).success).toBe(false)
    }
  })

  it('requires a 64-character lowercase hex token and no other credential field', () => {
    for (const ingressToken of [
      '',
      'abc',
      FIXTURE_TOKEN.toUpperCase(),
      `${FIXTURE_TOKEN}0`,
      null
    ]) {
      expect(DotIngressMetadataSchema.safeParse({ ...pipe, ingressToken }).success).toBe(false)
    }
    for (const field of ['authToken', 'token', 'cliToken']) {
      expect(DotIngressMetadataSchema.safeParse({ ...pipe, [field]: FIXTURE_TOKEN }).success).toBe(
        false
      )
    }
  })

  it('accepts contract version 1 only and a known schema version', () => {
    expect(DotIngressMetadataSchema.safeParse({ ...pipe, contractVersions: [1, 2] }).success).toBe(
      false
    )
    expect(DotIngressMetadataSchema.safeParse({ ...pipe, contractVersions: [] }).success).toBe(
      false
    )
    expect(DotIngressMetadataSchema.safeParse({ ...pipe, schemaVersion: 2 }).success).toBe(false)
  })

  it.each([
    ['pid 0', { pid: 0 }],
    ['negative pid', { pid: -1 }],
    ['fractional pid', { pid: 1.5 }],
    ['empty runtime id', { runtimeId: '' }],
    ['negative start time', { startedAt: -1 }]
  ])('refuses %s', (_label, override) => {
    expect(DotIngressMetadataSchema.safeParse({ ...pipe, ...override }).success).toBe(false)
  })

  it('refuses unknown fields so a stray secret cannot ride along', () => {
    expect(DotIngressMetadataSchema.safeParse({ ...pipe, extra: 'x' }).success).toBe(false)
    expect(
      DotIngressMetadataSchema.safeParse({
        ...pipe,
        transport: { ...pipe.transport, token: FIXTURE_TOKEN }
      }).success
    ).toBe(false)
  })
})
