import { describe, expect, it } from 'vitest'
import { at } from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { createDotRemotePresence, type DotRemoteWorkspaceEntry } from './dot-remote-presence'
import { fixtureClock, fixtureCredentials, scriptedSite, siteOk } from './dot-remote.test-fixture'

const DOCS: DotRemoteWorkspaceEntry = {
  workspaceRef: 'dws_0123456789abcdef01234567',
  displayName: 'Docs site',
  maxAccess: 'read_only'
}

function harness(initial: DotRemoteWorkspaceEntry[]) {
  const clock = fixtureClock(0)
  // Why unknown: some tests feed malformed entries on purpose, as a faulty reader could.
  let workspaces: unknown = initial
  const presence = createDotRemotePresence({
    now: clock.now,
    appVersion: '1.4.0',
    listWorkspaces: () => (Array.isArray(workspaces) ? workspaces : [])
  })
  const site = scriptedSite({
    'heartbeat.post': () => siteOk({ serverTime: at(0) }),
    'workspaces.put': () => siteOk({ storedAt: at(0) })
  })
  const binding = { credentials: fixtureCredentials(), generation: 1 }
  return {
    site,
    sync: () => presence.sync(site.client, binding),
    setWorkspaces: (next: unknown[]) => {
      workspaces = next
    },
    published: () => site.calls.filter((call) => call.name === 'workspaces.put')
  }
}

describe('dot remote presence (contract v4)', () => {
  it('states remote contract version 4 in its heartbeat', async () => {
    const presence = harness([DOCS])
    expect(await presence.sync()).toBeNull()
    expect(presence.site.calls[0]).toMatchObject({
      name: 'heartbeat.post',
      body: { generation: 1, appVersion: '1.4.0', contractVersion: 4 }
    })
  })

  it('publishes each workspace with its access maximum', async () => {
    const release: DotRemoteWorkspaceEntry = {
      workspaceRef: 'dws_89abcdef0123456789abcdef',
      displayName: 'Release notes',
      maxAccess: 'workspace_write'
    }
    const presence = harness([DOCS, release])
    await presence.sync()
    expect(presence.published()[0]?.body).toEqual({
      generation: 1,
      publishedAt: at(0),
      workspaces: [DOCS, release]
    })
  })

  it('publishes again when the user changes a maximum, and not otherwise', async () => {
    const presence = harness([DOCS])
    await presence.sync()
    await presence.sync()
    expect(presence.published()).toHaveLength(1)
    presence.setWorkspaces([{ ...DOCS, maxAccess: 'workspace_write' }])
    await presence.sync()
    expect(presence.published()).toHaveLength(2)
    expect(presence.published()[1]?.body).toMatchObject({
      workspaces: [{ ...DOCS, maxAccess: 'workspace_write' }]
    })
  })

  it('leaves out an entry without a valid maximum, or with a path, instead of guessing', async () => {
    const { maxAccess: _omitted, ...withoutMaximum } = DOCS
    const presence = harness([])
    presence.setWorkspaces([
      withoutMaximum,
      { ...DOCS, maxAccess: 'full_access' },
      { ...DOCS, path: 'C:/work/docs' }
    ])
    await presence.sync()
    expect(presence.published()[0]?.body).toMatchObject({ workspaces: [] })
  })
})
