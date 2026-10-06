import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_RUN_MESSAGE_MAX_UNITS,
  WorkbenchRoutingTableAcceptParams,
  WorkbenchRoutingTableCheckRoutesParams,
  WorkbenchRoutingTableImportParams,
  WorkbenchRoutingTableListParams,
  WorkbenchRoutingTableRejectParams,
  WorkbenchRoutingTableRevertParams,
  WorkbenchRunListParams,
  WorkbenchRunMessageParams,
  WorkbenchRunShowParams,
  WorkbenchRunStopParams
} from './workbench-run-params'

const KEY = '8f18f989-8a86-423e-8e45-3416e01a14d2'
const IMPORT = {
  schema_version: 1,
  proposer: 'user_import',
  base: { table_version: 1, sha256: 'b'.repeat(64) },
  changes: [],
  rationale: 'Use a different reviewer.',
  evidence: []
}

describe('run method params', () => {
  it('lists with a default page size and an optional workspace filter', () => {
    expect(WorkbenchRunListParams.parse({})).toEqual({ limit: 50 })
    expect(WorkbenchRunListParams.parse({ workspaceId: 'repo::C:\\work', limit: 3 })).toEqual({
      workspaceId: 'repo::C:\\work',
      limit: 3
    })
    expect(WorkbenchRunListParams.safeParse({ limit: 101 }).success).toBe(false)
    expect(WorkbenchRunListParams.safeParse({ workspaceId: ' ' }).success).toBe(false)
  })

  it.each([
    ['show', WorkbenchRunShowParams],
    ['stop', WorkbenchRunStopParams]
  ])('%s takes one run id and nothing else', (_name, schema) => {
    expect(schema.parse({ runId: 'run_fixture01' })).toEqual({ runId: 'run_fixture01' })
    expect(schema.safeParse({ runId: 'run with spaces' }).success).toBe(false)
    expect(schema.safeParse({ runId: 'run_fixture01', reason: 'x' }).success).toBe(false)
  })

  it('sends a desktop message with an idempotency key and bounded text', () => {
    const params = { runId: 'run_fixture01', idempotencyKey: KEY, text: 'Also check the tests.' }
    expect(WorkbenchRunMessageParams.parse(params)).toEqual(params)
    expect(WorkbenchRunMessageParams.safeParse({ ...params, text: '' }).success).toBe(false)
    const long = 'a'.repeat(WORKBENCH_RUN_MESSAGE_MAX_UNITS + 1)
    expect(WorkbenchRunMessageParams.safeParse({ ...params, text: long }).success).toBe(false)
    // D-027: the wire holds the app's 64 Ki code point ceiling, two UTF-16 units each at most.
    expect(WORKBENCH_RUN_MESSAGE_MAX_UNITS).toBe(2 * 65_536)
    const past4000 = 'b'.repeat(10_000)
    expect(WorkbenchRunMessageParams.safeParse({ ...params, text: past4000 }).success).toBe(true)
    expect(WorkbenchRunMessageParams.safeParse({ ...params, idempotencyKey: 'k' }).success).toBe(
      false
    )
  })

  it('lets no caller name the message source, so the desktop cannot pose as dot', () => {
    const params = { runId: 'run_fixture01', idempotencyKey: KEY, text: 'Hello.', source: 'dot' }
    expect(WorkbenchRunMessageParams.safeParse(params).success).toBe(false)
  })
})

describe('routing table method params', () => {
  it('lists with no input', () => {
    expect(WorkbenchRoutingTableListParams.parse({})).toEqual({})
    expect(WorkbenchRoutingTableListParams.safeParse({ all: true }).success).toBe(false)
  })

  it('accepts a proposal by id, optionally with the user modification', () => {
    expect(WorkbenchRoutingTableAcceptParams.parse({ proposalId: 'proposal-01' })).toEqual({
      proposalId: 'proposal-01'
    })
    const modified = WorkbenchRoutingTableAcceptParams.parse({
      proposalId: 'proposal-01',
      modification: { changes: [] }
    })
    expect(modified.modification).toEqual({ changes: [] })
    expect(WorkbenchRoutingTableAcceptParams.safeParse({ proposalId: 'p' }).success).toBe(false)
  })

  it('takes no caller from the wire: the desktop caller comes only from the RPC context', () => {
    for (const schema of [WorkbenchRoutingTableAcceptParams, WorkbenchRoutingTableRejectParams]) {
      expect(schema.safeParse({ proposalId: 'proposal-01', caller: 'desktop_user' }).success).toBe(
        false
      )
    }
    expect(
      WorkbenchRoutingTableRevertParams.safeParse({ version: 1, caller: 'desktop_user' }).success
    ).toBe(false)
  })

  it('imports one proposal submission', () => {
    expect(WorkbenchRoutingTableImportParams.parse({ proposal: IMPORT }).proposal).toMatchObject({
      proposer: 'user_import'
    })
    const unknownKey = { proposal: { ...IMPORT, active: true } }
    expect(WorkbenchRoutingTableImportParams.safeParse(unknownKey).success).toBe(false)
  })

  it('reverts to a positive version number', () => {
    expect(WorkbenchRoutingTableRevertParams.parse({ version: 2 })).toEqual({ version: 2 })
    expect(WorkbenchRoutingTableRevertParams.safeParse({ version: 0 }).success).toBe(false)
  })

  it('checks routes with no input: no workspace, subject or freshness comes from the wire', () => {
    expect(WorkbenchRoutingTableCheckRoutesParams.parse({})).toEqual({})
    for (const extra of [{ workspaceId: 'repo::C:\\work' }, { freshness: 'cached' }]) {
      expect(WorkbenchRoutingTableCheckRoutesParams.safeParse(extra).success).toBe(false)
    }
  })
})
