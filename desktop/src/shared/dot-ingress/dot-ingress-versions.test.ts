import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../english-text'
import { DOT_INGRESS_CONTRACT_VERSION } from './dot-ingress-limits'
import {
  DOT_INGRESS_CONTRACT_VERSION_THREE,
  DOT_INGRESS_CONTRACT_VERSION_TWO,
  DOT_INGRESS_METHOD_NAMES,
  DOT_INGRESS_METHOD_VERSIONS,
  DOT_INGRESS_SERVED_CONTRACT_VERSIONS,
  DOT_INGRESS_V2_METHOD_NAMES,
  DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE,
  dotMethodNeedsNewerVersionMessage,
  dotMethodsServedIn,
  isServedContractVersion
} from './dot-ingress-versions'

const V2_NAMES = [
  'dotIngress.hello',
  'dotIngress.workspaces.list',
  'dotIngress.requests.submit',
  'dotIngress.requests.status',
  'dotIngress.requests.list',
  'dotIngress.requests.cancel',
  'dotIngress.requests.message',
  'dotIngress.decisions.list',
  'dotIngress.decisions.answer'
]

describe('dot ingress contract versions', () => {
  it('serves the frozen versions 1 and 2 and the explicit version 3, nothing else', () => {
    expect(DOT_INGRESS_CONTRACT_VERSION).toBe(1)
    expect(DOT_INGRESS_CONTRACT_VERSION_TWO).toBe(2)
    expect(DOT_INGRESS_CONTRACT_VERSION_THREE).toBe(3)
    expect([...DOT_INGRESS_SERVED_CONTRACT_VERSIONS]).toEqual([1, 2, 3])
    for (const served of [1, 2, 3]) {
      expect(isServedContractVersion(served)).toBe(true)
    }
    for (const other of [0, 4, '1', 1.5, null, undefined]) {
      expect(isServedContractVersion(other), String(other)).toBe(false)
    }
  })

  it('names the closed method surface with the version that introduced each method', () => {
    expect([...DOT_INGRESS_METHOD_NAMES]).toEqual([
      ...V2_NAMES,
      'dotIngress.validations.list',
      'dotIngress.validations.decide'
    ])
    // Why frozen: the version 2 golden enumerates exactly these names.
    expect([...DOT_INGRESS_V2_METHOD_NAMES]).toEqual(V2_NAMES)
    expect(Object.keys(DOT_INGRESS_METHOD_VERSIONS)).toEqual([...DOT_INGRESS_METHOD_NAMES])
    // D-019: follow-up messages exist only from version 2 on; validation decisions from version 3.
    expect(DOT_INGRESS_METHOD_VERSIONS['dotIngress.requests.message']).toBe(2)
    expect(DOT_INGRESS_METHOD_VERSIONS['dotIngress.validations.list']).toBe(3)
    expect(DOT_INGRESS_METHOD_VERSIONS['dotIngress.validations.decide']).toBe(3)
    const later = new Set([
      'dotIngress.requests.message',
      'dotIngress.validations.list',
      'dotIngress.validations.decide'
    ])
    for (const name of DOT_INGRESS_METHOD_NAMES.filter((n) => !later.has(n))) {
      expect(DOT_INGRESS_METHOD_VERSIONS[name], name).toBe(1)
    }
  })

  it('lists for each version only the methods that version serves', () => {
    const registered = [...DOT_INGRESS_METHOD_NAMES]
    expect(dotMethodsServedIn(1, registered)).toEqual(
      V2_NAMES.filter((name) => name !== 'dotIngress.requests.message')
    )
    expect(dotMethodsServedIn(2, registered)).toEqual(V2_NAMES)
    expect(dotMethodsServedIn(3, registered)).toEqual(registered)
    expect(dotMethodsServedIn(3, ['dotIngress.hello', 'other.method'])).toEqual([
      'dotIngress.hello'
    ])
  })

  it('lists every served version in the unsupported-version message, in English', () => {
    expect(DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE).toBe(
      'Unsupported contract version. Supported versions: 1, 2, 3.'
    )
    const needsNewer = dotMethodNeedsNewerVersionMessage('dotIngress.requests.message')
    expect(needsNewer).toBe('This method needs contract version 2 or later.')
    const needsThree = dotMethodNeedsNewerVersionMessage('dotIngress.validations.decide')
    expect(needsThree).toBe('This method needs contract version 3 or later.')
    for (const message of [DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE, needsNewer, needsThree]) {
      expect(isEnglishText(message)).toBe(true)
    }
  })
})
