import { cleanCloudServiceOrigin } from '../../../shared/cloud-service-url'
import { ORCA_CLOUD_SERVICES_ENABLED } from '../../../shared/orca-cloud-services'

// Why null: NASH has no push gateway unless ORCA_PUSH_GATEWAY_URL names one (cloud services off).
export function resolvePushGatewayOrigin(env: NodeJS.ProcessEnv, packaged: boolean): string | null {
  const configured = cleanCloudServiceOrigin(env.ORCA_PUSH_GATEWAY_URL, !packaged)
  return configured ?? (ORCA_CLOUD_SERVICES_ENABLED ? 'https://push.onorca.dev' : null)
}
