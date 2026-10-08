import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DOT_REMOTE_ENDPOINTS, buildDotRemoteEndpointTable } from './dot-remote-endpoints'
import { DOT_REMOTE_ENVELOPE_FAMILIES } from './dot-remote-envelope-families'
import { closedObjectViolations, propertyNames } from './dot-remote-json-schema-walk.test-fixture'

// Hosted envelope freeze (RG2, RG6): generated like the current ingress contract golden. Codex builds the
// Site from these files and never hand-writes a schema; a change here is a deliberate contract edit.

const FAMILIES = Object.entries(DOT_REMOTE_ENVELOPE_FAMILIES)

describe('dot remote envelope goldens', () => {
  it('has one golden per envelope family', () => {
    expect(Object.keys(DOT_REMOTE_ENVELOPE_FAMILIES)).toEqual([
      'dot-remote-inbox.schema.json',
      'dot-remote-ack.schema.json',
      'dot-remote-receipt.schema.json',
      'dot-remote-events.schema.json',
      'dot-remote-presence.schema.json',
      'dot-remote-pairing.schema.json'
    ])
  })

  it.each(FAMILIES)('%s converts every schema to JSON Schema', (_file, family) => {
    for (const [name, schema] of Object.entries(family)) {
      expect(() => z.toJSONSchema(schema), name).not.toThrow()
    }
  })

  it.each(FAMILIES)('%s matches its golden JSON Schema snapshot', async (file, family) => {
    const snapshot = z.toJSONSchema(z.object(family), { reused: 'ref' })
    await expect(`${JSON.stringify(snapshot, null, 2)}\n`).toMatchFileSnapshot(`./${file}`)
  })

  it.each(FAMILIES)('%s closes every object it defines', (_file, family) => {
    for (const [name, schema] of Object.entries(family)) {
      expect(closedObjectViolations(z.toJSONSchema(schema, { io: 'input' })), name).toEqual([])
    }
  })

  it('mentions an objective only in the inbox, where the submit payload carries it', () => {
    for (const [file, family] of FAMILIES) {
      const names = propertyNames(z.toJSONSchema(z.object(family)))
      expect(names.includes('objective'), file).toBe(file === 'dot-remote-inbox.schema.json')
    }
  })
})

describe('dot remote endpoint table', () => {
  it('matches its golden file', async () => {
    const table = buildDotRemoteEndpointTable()
    await expect(`${JSON.stringify(table, null, 2)}\n`).toMatchFileSnapshot(
      './dot-remote-endpoints.json'
    )
  })

  it('points every request and response at a schema in a golden family', () => {
    for (const endpoint of DOT_REMOTE_ENDPOINTS) {
      for (const ref of [endpoint.request, endpoint.response]) {
        const family = DOT_REMOTE_ENVELOPE_FAMILIES[ref.file]
        expect(family?.[ref.key], `${endpoint.name} -> ${ref.file}#${ref.key}`).toBeDefined()
      }
    }
  })

  // Why: the desktop shows this address and the Site serves it; both read it from the contract.
  it('names the owner pairing page, under which the approval endpoint is served', () => {
    const table = buildDotRemoteEndpointTable()
    expect(table.ownerPages).toEqual({ pairingApproval: '/pairing' })
    const approve = DOT_REMOTE_ENDPOINTS.find((endpoint) => endpoint.name === 'pairing.approve')
    expect(approve?.path).toBe(`${table.ownerPages.pairingApproval}/approve`)
  })

  it('has unique names and unique method and path pairs', () => {
    const names = DOT_REMOTE_ENDPOINTS.map((endpoint) => endpoint.name)
    const routes = DOT_REMOTE_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(routes).size).toBe(routes.length)
  })
})
