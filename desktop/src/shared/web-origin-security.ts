// Why: a plain-http page on another machine can be swapped by anyone on the LAN path, so a
// pairing code typed into it is exposed. Browsers treat loopback http as a secure context.
export function isInsecureRemoteWebOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false
  }
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  return url.protocol === 'http:' && !isLoopbackHostname(url.hostname)
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  )
}

/** Sealed auth error for a first pairing from such a page without operator opt-in. */
export const INSECURE_WEB_ORIGIN_AUTH_CODE = 'insecure_origin' as const

// Operator opt-in, read by the host serving the page (desktop or `orca serve`).
export const ALLOW_INSECURE_WEB_PAIRING_ENV = 'ORCA_ALLOW_INSECURE_WEB_PAIRING' as const

// Why a marker: React Native phones also send an http Origin on LAN sockets, so the Origin alone
// cannot say "browser". Only the web bundle adds this query to its upgrade URL; hosts that predate
// it ignore the query string, so the marked upgrade still connects to them.
export const WEB_CLIENT_UPGRADE_PARAM = 'orca-client' as const
export const WEB_CLIENT_UPGRADE_VALUE = 'web' as const

export function withWebClientUpgradeMarker(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    url.searchParams.set(WEB_CLIENT_UPGRADE_PARAM, WEB_CLIENT_UPGRADE_VALUE)
    return url.toString()
  } catch {
    return endpoint
  }
}

/** True when an upgrade request path (`/path?query`) carries the web bundle's marker. */
export function hasWebClientUpgradeMarker(requestUrl: string | undefined): boolean {
  if (!requestUrl) {
    return false
  }
  try {
    return (
      new URL(requestUrl, 'http://upgrade.invalid').searchParams.get(WEB_CLIENT_UPGRADE_PARAM) ===
      WEB_CLIENT_UPGRADE_VALUE
    )
  } catch {
    return false
  }
}
