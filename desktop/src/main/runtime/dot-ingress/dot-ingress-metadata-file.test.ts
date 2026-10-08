import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type DotIngressMetadata,
  getDotIngressMetadataPath
} from '../../../shared/dot-ingress/dot-ingress-metadata'

import * as secureFile from '../../../shared/secure-file'
import { createDotIngressTransportMetadata } from '../runtime-rpc/runtime-rpc-socket-metadata'
import {
  DotIngressMetadataError,
  clearDotIngressMetadataIfOwned,
  clearStaleDotIngressMetadata,
  writeDotIngressMetadata
} from './dot-ingress-metadata-file'
import {
  FIXTURE_INGRESS_TOKEN,
  FIXTURE_RUNTIME_ID,
  readDotMetadata
} from './dot-ingress-transport.test-fixture'

vi.mock('../../../shared/secure-file', async (importOriginal) => {
  const actual = await importOriginal<typeof secureFile>()
  return { ...actual, writeSecureJsonFile: vi.fn(actual.writeSecureJsonFile) }
})

const KNOWN_DEAD_PID = 99_999_999
const FOREIGN_LIVE_PID = process.pid
const OWN_PID = 4242

const metadataFor = (overrides: Partial<DotIngressMetadata> = {}): DotIngressMetadata => ({
  schemaVersion: 1,
  runtimeId: FIXTURE_RUNTIME_ID,
  pid: OWN_PID,
  startedAt: 1_790_000_000_000,
  contractVersions: [3],
  // Why: derived from the runtime naming code, so the fixture follows the app identity prefix.
  transport: createDotIngressTransportMetadata('/data', OWN_PID, 'win32', 'ab12'),
  ingressToken: FIXTURE_INGRESS_TOKEN,
  ...overrides
})

const owner = { pid: OWN_PID, runtimeId: FIXTURE_RUNTIME_ID, ingressToken: FIXTURE_INGRESS_TOKEN }

function reasonOf(operation: () => void): string | undefined {
  try {
    operation()
    return undefined
  } catch (error) {
    return error instanceof DotIngressMetadataError ? error.reason : 'not_a_metadata_error'
  }
}

describe('dot ingress discovery file', () => {
  let userDataPath: string
  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'dot-ingress-meta-'))
    vi.mocked(secureFile.writeSecureJsonFile).mockClear()
  })

  describe('writing', () => {
    it('publishes the metadata through the owner-only secure writer', () => {
      const metadata = metadataFor()

      writeDotIngressMetadata(userDataPath, metadata)

      expect(secureFile.writeSecureJsonFile).toHaveBeenCalledWith(
        getDotIngressMetadataPath(userDataPath),
        metadata
      )
      expect(readDotMetadata(userDataPath)).toEqual(metadata)
    })

    it.runIf(process.platform !== 'win32')('leaves the file readable by its owner only', () => {
      writeDotIngressMetadata(userDataPath, metadataFor())

      expect(statSync(getDotIngressMetadataPath(userDataPath)).mode & 0o777).toBe(0o600)
    })

    it('refuses metadata the shared schema would reject, and writes nothing', () => {
      const dot = createDotIngressTransportMetadata('/data', OWN_PID, 'win32', 'ab12')
      const invalid = metadataFor({
        // The main endpoint, which is not a dot endpoint.
        transport: { ...dot, endpoint: dot.endpoint.replace(/-dot$/, '') }
      })

      expect(reasonOf(() => writeDotIngressMetadata(userDataPath, invalid))).toBe('invalid')
      expect(existsSync(getDotIngressMetadataPath(userDataPath))).toBe(false)
      expect(secureFile.writeSecureJsonFile).not.toHaveBeenCalled()
    })

    it('removes a file whose permissions could not be restricted and reports it', () => {
      vi.mocked(secureFile.writeSecureJsonFile).mockImplementationOnce((path, value) => {
        writeFileSync(path, JSON.stringify(value))
        return false
      })

      expect(reasonOf(() => writeDotIngressMetadata(userDataPath, metadataFor()))).toBe(
        'not_secured'
      )
      expect(existsSync(getDotIngressMetadataPath(userDataPath))).toBe(false)
    })

    it('reports a write failure without leaving a partial file', () => {
      mkdirSync(getDotIngressMetadataPath(userDataPath))

      expect(reasonOf(() => writeDotIngressMetadata(userDataPath, metadataFor()))).toBe(
        'write_failed'
      )
    })

    it('keeps the token out of every failure message', () => {
      const invalid = metadataFor({ transport: { kind: 'unix', endpoint: '/tmp/not-an-endpoint' } })
      mkdirSync(getDotIngressMetadataPath(userDataPath))
      const messages = [invalid, metadataFor()].map((metadata) => {
        try {
          writeDotIngressMetadata(userDataPath, metadata)
          return ''
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      })

      expect(messages.every((message) => message.length > 0)).toBe(true)
      expect(messages.join('\n')).not.toContain(FIXTURE_INGRESS_TOKEN)
    })
  })

  describe('clearing what this listener wrote', () => {
    it('removes the file when pid, runtime id and token all match', () => {
      writeDotIngressMetadata(userDataPath, metadataFor())

      expect(clearDotIngressMetadataIfOwned(userDataPath, owner)).toBe(true)
      expect(existsSync(getDotIngressMetadataPath(userDataPath))).toBe(false)
    })

    it.each([
      ['pid', metadataFor({ pid: OWN_PID + 1 })],
      ['runtime id', metadataFor({ runtimeId: 'runtime-fixture-2' })],
      ['token', metadataFor({ ingressToken: 'f'.repeat(64) })]
    ])('keeps a file written by someone with a different %s', (_name, foreign) => {
      writeDotIngressMetadata(userDataPath, foreign)

      expect(clearDotIngressMetadataIfOwned(userDataPath, owner)).toBe(false)
      expect(readDotMetadata(userDataPath)).toEqual(foreign)
    })

    it('keeps a file it cannot prove is its own, and tolerates a missing one', () => {
      expect(clearDotIngressMetadataIfOwned(userDataPath, owner)).toBe(false)

      writeFileSync(getDotIngressMetadataPath(userDataPath), '{ not json')
      expect(clearDotIngressMetadataIfOwned(userDataPath, owner)).toBe(false)
      expect(existsSync(getDotIngressMetadataPath(userDataPath))).toBe(true)
    })
  })

  describe('clearing what a dead runtime left behind', () => {
    it('removes a file whose runtime process no longer exists', () => {
      writeDotIngressMetadata(userDataPath, metadataFor({ pid: KNOWN_DEAD_PID }))

      expect(clearStaleDotIngressMetadata(userDataPath, OWN_PID)).toBe(true)
      expect(existsSync(getDotIngressMetadataPath(userDataPath))).toBe(false)
    })

    it('keeps a file owned by this process or by another live runtime', () => {
      writeDotIngressMetadata(userDataPath, metadataFor({ pid: OWN_PID }))
      expect(clearStaleDotIngressMetadata(userDataPath, OWN_PID)).toBe(false)

      writeDotIngressMetadata(userDataPath, metadataFor({ pid: FOREIGN_LIVE_PID }))
      expect(clearStaleDotIngressMetadata(userDataPath, OWN_PID)).toBe(false)
      expect(existsSync(getDotIngressMetadataPath(userDataPath))).toBe(true)
    })

    it('leaves an unreadable file alone and tolerates a missing one', () => {
      expect(clearStaleDotIngressMetadata(userDataPath, OWN_PID)).toBe(false)

      writeFileSync(getDotIngressMetadataPath(userDataPath), 'garbage')
      expect(clearStaleDotIngressMetadata(userDataPath, OWN_PID)).toBe(false)
      expect(existsSync(getDotIngressMetadataPath(userDataPath))).toBe(true)
    })
  })
})
