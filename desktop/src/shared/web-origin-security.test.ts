import { describe, expect, it } from 'vitest'
import {
  hasWebClientUpgradeMarker,
  isInsecureRemoteWebOrigin,
  withWebClientUpgradeMarker
} from './web-origin-security'

describe('isInsecureRemoteWebOrigin', () => {
  it('flags plain http pages served to other machines', () => {
    expect(isInsecureRemoteWebOrigin('http://192.168.1.20:6768')).toBe(true)
    expect(isInsecureRemoteWebOrigin('http://desk.local')).toBe(true)
    expect(isInsecureRemoteWebOrigin('http://[fe80::1]:6768')).toBe(true)
  })

  it('treats https and loopback pages as secure', () => {
    expect(isInsecureRemoteWebOrigin('https://desk.example.com')).toBe(false)
    expect(isInsecureRemoteWebOrigin('http://localhost:6768')).toBe(false)
    expect(isInsecureRemoteWebOrigin('http://app.localhost')).toBe(false)
    expect(isInsecureRemoteWebOrigin('http://127.0.0.1:6768')).toBe(false)
    expect(isInsecureRemoteWebOrigin('http://127.8.0.1')).toBe(false)
    expect(isInsecureRemoteWebOrigin('http://[::1]:6768')).toBe(false)
  })

  it('leaves non-browser and unparseable origins to token auth', () => {
    expect(isInsecureRemoteWebOrigin(undefined)).toBe(false)
    expect(isInsecureRemoteWebOrigin('null')).toBe(false)
    expect(isInsecureRemoteWebOrigin('file://')).toBe(false)
    expect(isInsecureRemoteWebOrigin('not a url')).toBe(false)
  })
})

describe('web client upgrade marker', () => {
  it('round-trips through the endpoint the web bundle dials', () => {
    const marked = withWebClientUpgradeMarker('ws://192.168.1.20:6768')
    expect(marked).toBe('ws://192.168.1.20:6768/?orca-client=web')
    expect(hasWebClientUpgradeMarker(new URL(marked).pathname + new URL(marked).search)).toBe(true)
    expect(withWebClientUpgradeMarker('wss://desk.example.com/orca?x=1')).toBe(
      'wss://desk.example.com/orca?x=1&orca-client=web'
    )
  })

  it('is absent for phones, CLIs and other paths', () => {
    expect(hasWebClientUpgradeMarker('/')).toBe(false)
    expect(hasWebClientUpgradeMarker(undefined)).toBe(false)
    expect(hasWebClientUpgradeMarker('/?orca-client=phone')).toBe(false)
  })
})
