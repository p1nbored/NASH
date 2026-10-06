import { describe, expect, it } from 'vitest'
import { resolvePushGatewayOrigin } from './push-gateway-origin'

describe('push gateway origin in NASH builds (Orca cloud services off)', () => {
  it('has no default gateway, so no notification can reach push.onorca.dev', () => {
    expect(resolvePushGatewayOrigin({}, true)).toBeNull()
    expect(resolvePushGatewayOrigin({}, false)).toBeNull()
  })

  it('keeps an explicit HTTPS gateway override', () => {
    expect(
      resolvePushGatewayOrigin({ ORCA_PUSH_GATEWAY_URL: 'https://push.example.test/' }, true)
    ).toBe('https://push.example.test')
  })
})
