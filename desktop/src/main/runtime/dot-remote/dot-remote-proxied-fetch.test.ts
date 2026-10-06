// FIXTURE_ONLY: a fake HttpClient and a fake proxy step; nothing reaches a network or a session.
import { describe, expect, it, vi } from 'vitest'
import type { MainHttpClient } from '../../network/http-client'
import { createDotRemoteProxiedFetch } from './dot-remote-proxied-fetch'
import { FIXTURE_ORIGIN } from './dot-remote.test-fixture'

const URL_ON_SITE = `${FIXTURE_ORIGIN}/nash/v1/heartbeat`

function fixture(options: { session?: boolean; proxyFails?: boolean } = {}) {
  const order: string[] = []
  const session = { fixtureSession: true }
  const client = {
    fetch: vi.fn(async () => {
      order.push('fetch')
      return new Response('{}')
    }),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the proxy step is faked; it only passes the session through.
    proxySession: () => (options.session ? (session as never) : null)
  } satisfies MainHttpClient
  const prepareProxy = vi.fn(async () => {
    order.push('proxy')
    if (options.proxyFails) {
      throw new Error('FIXTURE_ONLY: proxy setup failed at C:/fixture/secret-path')
    }
  })
  const log = vi.fn()
  const fetch = createDotRemoteProxiedFetch({ client: () => client, prepareProxy, log })
  return { fetch, client, prepareProxy, log, order, session }
}

describe('createDotRemoteProxiedFetch', () => {
  it('applies the environment proxy to the client session before the request', async () => {
    const { fetch, client, prepareProxy, order, session } = fixture({ session: true })
    await fetch(URL_ON_SITE, { method: 'POST' })
    expect(order).toEqual(['proxy', 'fetch'])
    expect(prepareProxy).toHaveBeenCalledWith({
      proxySession: session,
      probeUrl: `${FIXTURE_ORIGIN}/`
    })
    expect(client.fetch).toHaveBeenCalledWith(URL_ON_SITE, { method: 'POST' })
  })

  it('names no session on a host without one', async () => {
    const { fetch, prepareProxy } = fixture()
    await fetch(URL_ON_SITE, { method: 'POST' })
    expect(prepareProxy).toHaveBeenCalledWith({ probeUrl: `${FIXTURE_ORIGIN}/` })
  })

  it('still sends when the proxy step fails, and logs a code without the error text', async () => {
    const { fetch, client, log } = fixture({ proxyFails: true })
    await fetch(URL_ON_SITE, { method: 'POST' })
    expect(client.fetch).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledExactlyOnceWith({ event: 'proxy_setup_failed' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-path')
  })
})
