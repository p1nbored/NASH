import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  ProposalIdSchema,
  StoredProposalSchema,
  type StoredProposal
} from '../../shared/routing-table/routing-table-proposal-schema'
import {
  ROUTING_TABLE_SCHEMA_VERSION,
  RoutingTableSchema,
  Sha256HexSchema,
  type RoutingTable
} from '../../shared/routing-table/routing-table-schema'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import { parseRoutingTableText, routingTableFileText } from './routing-table-bundle'

/** Raw file access for the routing-table folder: the index, immutable versions and proposals. */

export const ROUTING_TABLE_DIR_NAME = 'routing-table'
const INDEX_FILE_NAME = 'index.json'
const VERSIONS_DIR_NAME = 'versions'
const PROPOSALS_DIR_NAME = 'proposals'
// Why: the index grows by one short entry per accepted version, so this is never reached in practice.
const MAX_INDEX_BYTES = 4 * 1024 * 1024
const MAX_PROPOSAL_BYTES = 64 * 1024
const PROPOSAL_FILE = /^([A-Za-z0-9_-]{8,64})\.json$/

/** The app's user data folder, injected so this module never names an application folder. */
export type RoutingTablePathPort = { readonly getUserDataPath: () => string }

/** Synchronous so a table can be read inside a write transaction, like the verified profile store. */
export type RoutingTableFs = {
  /** Throws an error with code ENOENT when the file is missing. */
  readFile(path: string): string
  writeFileAtomically(path: string, data: string): void
  ensureDir(path: string): void
  /** Names of the files in a folder; empty when the folder does not exist. */
  listFileNames(directory: string): string[]
}

export function createNodeRoutingTableFs(): RoutingTableFs {
  return {
    readFile: (path) => readFileSync(path, 'utf8'),
    // Why the shared writer: it retries the Windows userData EPERM that a bare rename does not.
    writeFileAtomically: (path, data) => writeFileAtomically(path, data),
    ensureDir: (path) => {
      mkdirSync(path, { recursive: true })
    },
    listFileNames: (directory) => {
      try {
        return readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name)
      } catch (error) {
        if (isMissingFileError(error)) {
          return []
        }
        throw error
      }
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

const IndexEntrySchema = z
  .object({
    table_version: z.number().int().min(1),
    sha256: Sha256HexSchema,
    source: z.enum(['bundled', 'user']),
    accepted_at: z.iso.datetime({ offset: true }),
    proposal_id: ProposalIdSchema.nullable()
  })
  .strict()

export const RoutingTableIndexSchema = z
  .object({
    schema_version: z.literal(ROUTING_TABLE_SCHEMA_VERSION),
    active_version: z.number().int().min(1),
    /** The newest bundled table version this install has installed or been offered as a proposal. */
    bundled_version_seen: z.number().int().min(0),
    versions: z.array(IndexEntrySchema).min(1)
  })
  .strict()
  .superRefine((index, ctx) => {
    const numbers = index.versions.map((entry) => entry.table_version)
    if (
      !numbers.every((value, position) => position === 0 || value > (numbers[position - 1] ?? 0))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['versions'],
        message: 'Versions must be strictly ascending'
      })
    }
    if (!numbers.includes(index.active_version)) {
      ctx.addIssue({
        code: 'custom',
        path: ['active_version'],
        message: 'The active version is not listed'
      })
    }
  })
export type RoutingTableIndex = z.infer<typeof RoutingTableIndexSchema>
export type RoutingTableIndexEntry = RoutingTableIndex['versions'][number]

export type FileRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'missing' | 'unreadable' | 'invalid' }

export type RoutingTableFileStore = {
  readonly directory: string
  readIndex(): FileRead<RoutingTableIndex>
  writeIndex(index: RoutingTableIndex): void
  readVersion(version: number): FileRead<RoutingTable>
  writeVersion(table: RoutingTable): void
  /** True when an index or any version file exists, so first-start installation cannot overwrite them. */
  hasAnyStoredFile(): boolean
  readProposal(proposalId: string): FileRead<StoredProposal>
  writeProposal(stored: StoredProposal): void
  listProposalIds(): string[]
}

function versionFileName(version: number): string {
  return `v${String(version).padStart(4, '0')}.json`
}

export function createRoutingTableFileStore(options: {
  paths: RoutingTablePathPort
  fs: RoutingTableFs
}): RoutingTableFileStore {
  const { paths, fs } = options
  const directory = (): string => join(paths.getUserDataPath(), ROUTING_TABLE_DIR_NAME)

  function readText(path: string): FileRead<string> {
    try {
      return { ok: true, value: fs.readFile(path) }
    } catch (error) {
      return { ok: false, reason: isMissingFileError(error) ? 'missing' : 'unreadable' }
    }
  }

  function readJson<T>(path: string, maxBytes: number, schema: z.ZodType<T>): FileRead<T> {
    const text = readText(path)
    if (!text.ok) {
      return text
    }
    if (Buffer.byteLength(text.value, 'utf8') > maxBytes) {
      return { ok: false, reason: 'invalid' }
    }
    try {
      const parsed = schema.safeParse(JSON.parse(text.value))
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: 'invalid' }
    } catch {
      return { ok: false, reason: 'invalid' }
    }
  }

  function writeJson<T>(folder: string, fileName: string, schema: z.ZodType<T>, value: T): void {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      throw new Error(`Refusing to write an invalid ${fileName}`)
    }
    fs.ensureDir(folder)
    fs.writeFileAtomically(join(folder, fileName), `${JSON.stringify(parsed.data, null, 2)}\n`)
  }

  return {
    get directory() {
      return directory()
    },

    readIndex: () =>
      readJson(join(directory(), INDEX_FILE_NAME), MAX_INDEX_BYTES, RoutingTableIndexSchema),

    writeIndex: (index) => writeJson(directory(), INDEX_FILE_NAME, RoutingTableIndexSchema, index),

    readVersion(version) {
      if (!Number.isInteger(version) || version < 1) {
        return { ok: false, reason: 'invalid' }
      }
      const text = readText(join(directory(), VERSIONS_DIR_NAME, versionFileName(version)))
      if (!text.ok) {
        return text
      }
      const parsed = parseRoutingTableText(text.value)
      // Why the number check: a version file copied under another name must not pass as that version.
      return parsed.ok && parsed.table.table_version === version
        ? { ok: true, value: parsed.table }
        : { ok: false, reason: 'invalid' }
    },

    writeVersion(table) {
      const parsed = RoutingTableSchema.safeParse(table)
      if (!parsed.success) {
        throw new Error('Refusing to write an invalid routing table')
      }
      const folder = join(directory(), VERSIONS_DIR_NAME)
      fs.ensureDir(folder)
      fs.writeFileAtomically(
        join(folder, versionFileName(parsed.data.table_version)),
        routingTableFileText(parsed.data)
      )
    },

    hasAnyStoredFile() {
      return (
        fs.listFileNames(directory()).includes(INDEX_FILE_NAME) ||
        fs.listFileNames(join(directory(), VERSIONS_DIR_NAME)).length > 0
      )
    },

    readProposal(proposalId) {
      if (!ProposalIdSchema.safeParse(proposalId).success) {
        return { ok: false, reason: 'invalid' }
      }
      const read = readJson(
        join(directory(), PROPOSALS_DIR_NAME, `${proposalId}.json`),
        MAX_PROPOSAL_BYTES,
        StoredProposalSchema
      )
      return read.ok && read.value.proposal.proposal_id !== proposalId
        ? { ok: false, reason: 'invalid' }
        : read
    },

    writeProposal: (stored) =>
      writeJson(
        join(directory(), PROPOSALS_DIR_NAME),
        `${stored.proposal.proposal_id}.json`,
        StoredProposalSchema,
        stored
      ),

    listProposalIds() {
      return fs
        .listFileNames(join(directory(), PROPOSALS_DIR_NAME))
        .flatMap((name) => PROPOSAL_FILE.exec(name)?.[1] ?? [])
    }
  }
}
