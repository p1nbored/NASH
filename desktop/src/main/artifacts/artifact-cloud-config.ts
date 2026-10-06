import { app } from 'electron'
import { ORCA_CLOUD_SERVICES_ENABLED } from '../../shared/orca-cloud-services'

const PRODUCTION_ARTIFACTS_API_URL = 'https://share.onorca.dev'

function isPackaged(): boolean {
  try {
    return app?.isPackaged === true
  } catch {
    return false
  }
}

/**
 * Why a NASH build declines an artifact or skill share request, or null when an origin is set.
 * Only the environment counts: an `--api-url` or RPC override comes from a caller, not the user's setup.
 */
export function orcaShareServiceUnavailableMessage(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const explicit = Boolean(env.ORCA_ARTIFACTS_API_URL?.trim())
  return ORCA_CLOUD_SERVICES_ENABLED || explicit
    ? null
    : 'Orca artifact and skill sharing is not available in NASH builds.'
}

export function resolveArtifactCloudApiUrl(
  override?: string,
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): string {
  const unavailable = orcaShareServiceUnavailableMessage(env)
  if (unavailable) {
    // Why: NASH has no default share origin (Orca cloud services off), so nothing reaches Orca.
    throw new Error(unavailable)
  }
  const candidate = override?.trim() || env.ORCA_ARTIFACTS_API_URL?.trim()
  const url = new URL(candidate || PRODUCTION_ARTIFACTS_API_URL)
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  const firstParty = url.hostname === 'onorca.dev' || url.hostname.endsWith('.onorca.dev')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !packaged)) {
    throw new Error('Artifact API URLs must use HTTPS; local development may use loopback HTTP.')
  }
  if (!firstParty && !loopback) {
    throw new Error('Artifact API URLs must use an onorca.dev or loopback host.')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Artifact API URL must be an origin without credentials, paths, or parameters.')
  }
  return url.origin
}

export function allowsArtifactCloudAuthOverride(
  env: NodeJS.ProcessEnv = process.env,
  packaged = isPackaged()
): boolean {
  return env.NODE_ENV !== 'production' && !packaged
}
