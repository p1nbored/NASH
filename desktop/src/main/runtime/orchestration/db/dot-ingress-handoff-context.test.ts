import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { getDotIngressHandoffContext } from './dot-ingress-handoff-context'
import { getDotIngressSettingsStore } from './dot-ingress-settings-store'
import { getDotIngressStore } from './dot-ingress-store'
import {
  FIXTURE_OBJECTIVE,
  enableFixtureInterface,
  errorCodeOf,
  fixtureTime,
  submitInput
} from './dot-ingress.test-fixture'

describe('dot ingress handoff context', () => {
  let owner: OrchestrationDb
  let ref: string
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
    ref = enableFixtureInterface(owner)
  })
  afterEach(() => owner.close())

  const submitAndLink = (
    overrides: Parameters<typeof submitInput>[1],
    workbenchRequestId: string
  ): string => {
    const store = getDotIngressStore(owner)
    const { record } = store.submit(submitInput(ref, overrides))
    store.linkSubmitted({
      dotRequestId: record.dotRequestId,
      workbenchRequestId,
      timestamp: fixtureTime(20)
    })
    return record.dotRequestId
  }

  it('is null for a Workbench request that did not come from the dot', () => {
    expect(getDotIngressHandoffContext(owner, 'wb-desktop-1')).toBeNull()
  })

  it('is null for a dot request whose intake has not produced a Workbench request yet', () => {
    getDotIngressStore(owner).submit(submitInput(ref))
    expect(getDotIngressHandoffContext(owner, 'wb-1')).toBeNull()
  })

  it('gives the objective and provenance without reviving a retired output-language directive', () => {
    const objective = '  Écris le plan pour `docs/Résumé.md`.\r\n'
    const id = submitAndLink(
      {
        objective,
        requestedAccess: 'workspace_write',
        client: { name: 'dot-local', version: '0.1.0' },
        scanRules: ['posix_absolute_path']
      },
      'wb-1'
    )
    expect(getDotIngressHandoffContext(owner, 'wb-1')).toEqual({
      dotRequestId: id,
      source: 'dot_ingress',
      senderAuth: 'ingress_token_holder',
      client: { name: 'dot-local', version: '0.1.0' },
      objective,
      spanCount: 1,
      scanRules: ['posix_absolute_path'],
      requestedAccess: 'workspace_write',
      receivedAt: fixtureTime(10)
    })
  })

  it('adds no directive and no client when the dot sent neither', () => {
    const id = submitAndLink({}, 'wb-2')
    expect(getDotIngressHandoffContext(owner, 'wb-2')).toMatchObject({
      dotRequestId: id,
      client: null,
      objective: FIXTURE_OBJECTIVE,
      requestedAccess: 'read_only'
    })
  })

  it('still answers for a request the dot canceled, since the Workbench request keeps its origin', () => {
    const id = submitAndLink({}, 'wb-3')
    getDotIngressStore(owner).cancel({ dotRequestId: id, timestamp: fixtureTime(30) })
    expect(getDotIngressHandoffContext(owner, 'wb-3')?.dotRequestId).toBe(id)
  })

  it('does not depend on the interface being on: the origin of an existing request never changes', () => {
    submitAndLink({}, 'wb-4')
    getDotIngressSettingsStore(owner).setEnabled({ enabled: false, timestamp: fixtureTime(40) })
    expect(getDotIngressHandoffContext(owner, 'wb-4')).not.toBeNull()
  })

  it('refuses a blank Workbench request id', () => {
    expect(errorCodeOf(() => getDotIngressHandoffContext(owner, '  '))).toBe('dot_invalid_input')
  })
})
