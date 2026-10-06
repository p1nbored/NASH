import { getMainHttpClient, type MainHttpClient } from '../../network/http-client'
import type { ProxySession } from '../../network/electron-default-proxy-session'
import { ensureElectronProxyFromEnvironment } from '../../network/proxy-settings'
import type { DotRemoteFetch } from './dot-remote-site-client'
import type { DotRemoteLog } from './dot-remote-timers'

// Hop B over Orca's main HttpClient (Electron net.fetch on the guarded default session), with the
// environment proxy applied first, as Clef and Jira do. The proxy step is memoized by its owner.

type PrepareProxy = (options: { proxySession?: ProxySession; probeUrl: string }) => Promise<unknown>

export type DotRemoteProxiedFetchInput = {
  readonly log: DotRemoteLog
  readonly client?: () => MainHttpClient
  readonly prepareProxy?: PrepareProxy
}

export function createDotRemoteProxiedFetch(input: DotRemoteProxiedFetchInput): DotRemoteFetch {
  const client = input.client ?? getMainHttpClient
  const prepareProxy = input.prepareProxy ?? ensureElectronProxyFromEnvironment
  return async (url, init) => {
    const http = client()
    const proxySession = http.proxySession()
    try {
      await prepareProxy({
        ...(proxySession ? { proxySession } : {}),
        probeUrl: `${new URL(url).origin}/`
      })
    } catch {
      // Why send anyway: the session keeps its last proxy state; the error text may name local paths.
      input.log({ event: 'proxy_setup_failed' })
    }
    return http.fetch(url, init)
  }
}
