import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDotRemoteEndpointTable,
  DOT_REMOTE_OWNER_PAGES as FROM_TABLE
} from './dot-remote-endpoints'
import { DOT_REMOTE_OWNER_PAGES } from './dot-remote-owner-pages'

describe('DOT_REMOTE_OWNER_PAGES', () => {
  it('is the very object the endpoint table publishes', () => {
    expect(FROM_TABLE).toBe(DOT_REMOTE_OWNER_PAGES)
    expect(buildDotRemoteEndpointTable().ownerPages).toBe(DOT_REMOTE_OWNER_PAGES)
  })

  // Why: the renderer reads it, and the endpoint module pulls in node:crypto through the payloads.
  it('lives in a module that imports nothing', () => {
    const source = readFileSync(join(__dirname, 'dot-remote-owner-pages.ts'), 'utf8')
    expect(source).not.toMatch(/\bimport\b|\brequire\(/)
  })
})
