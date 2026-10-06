import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DotIngressMetadataSchema } from '../../shared/dot-ingress/dot-ingress-metadata'
import {
  RUNTIME_SOCKET_NAME_REGEX,
  createDotIngressTransportMetadata,
  createRuntimeTransportMetadata,
  deriveDotIngressTransport,
  sweepOrphanedRuntimeSockets
} from './runtime-rpc/runtime-rpc-socket-metadata'

const FIXTURE_TOKEN = '0123456789abcdef'.repeat(4)
const PLATFORMS: readonly NodeJS.Platform[] = ['win32', 'linux', 'darwin']
const RUNTIME_IDS = ['runtime-fixture-1', 'a', '!!', 'ab-cd_ef', undefined]

function asDiscoveryFile(transport: { kind: string; endpoint: string }) {
  return {
    schemaVersion: 1,
    runtimeId: 'runtime-fixture-1',
    pid: 4321,
    startedAt: 1_790_000_000_000,
    contractVersions: [1],
    transport,
    ingressToken: FIXTURE_TOKEN
  }
}

describe('dot ingress endpoint naming', () => {
  describe.each(PLATFORMS)('on %s', (platform) => {
    it.each(RUNTIME_IDS)('is the main endpoint name plus the -dot suffix (runtime %s)', (id) => {
      const main = createRuntimeTransportMetadata('/data/NASH', 4321, platform, id)
      const dot = createDotIngressTransportMetadata('/data/NASH', 4321, platform, id)

      expect(dot.kind).toBe(main.kind)
      expect(dot.endpoint).not.toBe(main.endpoint)
      if (main.kind === 'named-pipe') {
        expect(dot.endpoint).toBe(`${main.endpoint}-dot`)
      } else {
        expect(dirname(dot.endpoint)).toBe(dirname(main.endpoint))
        expect(basename(dot.endpoint)).toBe(basename(main.endpoint).replace(/\.sock$/, '-dot.sock'))
      }
    })

    // Why: the shared socket pattern expects forward slashes, which only a POSIX host produces.
    it.runIf(platform === 'win32' || process.platform !== 'win32').each(RUNTIME_IDS)(
      'is accepted by the shared discovery-file schema (runtime %s)',
      (id) => {
        const dot = createDotIngressTransportMetadata('/data/NASH', 4321, platform, id)

        expect(DotIngressMetadataSchema.safeParse(asDiscoveryFile(dot)).success).toBe(true)
      }
    )
  })

  it('reads the identity prefix from the main endpoint instead of spelling it out', () => {
    const main = createRuntimeTransportMetadata('/data/NASH', 4321, 'win32', 'runtime-fixture-1')
    const dot = createDotIngressTransportMetadata('/data/NASH', 4321, 'win32', 'runtime-fixture-1')

    expect(dot.endpoint.startsWith(main.endpoint)).toBe(true)
    expect(
      deriveDotIngressTransport({ kind: 'named-pipe', endpoint: '\\\\.\\pipe\\nash-9-ab12' })
    ).toEqual({ kind: 'named-pipe', endpoint: '\\\\.\\pipe\\nash-9-ab12-dot' })
    expect(deriveDotIngressTransport({ kind: 'unix', endpoint: '/data/n-9-ab12.sock' })).toEqual({
      kind: 'unix',
      endpoint: '/data/n-9-ab12-dot.sock'
    })
  })

  it('refuses a main endpoint shape it cannot derive from, so it can never share the main endpoint', () => {
    expect(() =>
      deriveDotIngressTransport({ kind: 'unix', endpoint: '/data/main-socket' })
    ).toThrow(/dot ingress/i)
    expect(() =>
      deriveDotIngressTransport({ kind: 'websocket', endpoint: 'ws://127.0.0.1:1' })
    ).toThrow(/dot ingress/i)
  })

  it('stays inside the orphan-socket sweep, so a crash leaves nothing behind after the next start', () => {
    const dot = createDotIngressTransportMetadata('/data/NASH', 4321, 'linux', 'runtime-fixture-1')

    expect(RUNTIME_SOCKET_NAME_REGEX.test(basename(dot.endpoint))).toBe(true)
  })

  it.runIf(process.platform !== 'win32')('lets the sweep reap a dead runtime socket file', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'dot-ingress-sweep-'))
    const deadPid = 99_999_999
    const orphan = createDotIngressTransportMetadata(userDataPath, deadPid, 'linux', 'rt-1')
    writeFileSync(orphan.endpoint, '')

    sweepOrphanedRuntimeSockets(userDataPath, process.pid)

    expect(existsSync(orphan.endpoint)).toBe(false)
  })
})
