import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DOT_REMOTE_ENDPOINTS, dotRemoteEndpointSchemas } from './dot-remote-endpoints'
import {
  DOT_REMOTE_OWNER_IDENTITY_HEADER,
  DOT_REMOTE_SERVICE_AUTH_HEADER,
  DOT_REMOTE_SESSION_HEADER,
  DotRemoteChallengeCreateRequestSchema,
  DotRemoteChallengeSchema,
  DotRemotePairingBindingSchema,
  DotRemoteSessionIssueRequestSchema,
  DotRemoteSessionIssueResponseSchema,
  DotRemoteSessionRenewRequestSchema
} from './dot-remote-pairing'
import {
  DotRemoteHeartbeatRequestSchema,
  DotRemoteStatusViewSchema,
  DotRemoteWorkspaceListRequestSchema
} from './dot-remote-presence'
import { propertyNames } from './dot-remote-json-schema-walk.test-fixture'

const T0 = '2026-10-05T12:00:00.000Z'
const CHALLENGE_ID = '70000000-0000-4000-8000-000000000001'
const FAKE_DEVICE_CODE = 'FIXTUREdeviceCode000000000000000000000000001'
const FAKE_DEVICE_CREDENTIAL =
  'ndc_000000000000000000000001.FIXTUREdeviceCredentialSecret00000000000000000001'
const TOKEN_FIELD = /token|authorization|bearer|secret|password|api[-_]?key|cookie|credential/i

describe('pairing (RG4)', () => {
  it('sends the platform token only in the service header and the app session in its own header', () => {
    expect(DOT_REMOTE_SERVICE_AUTH_HEADER).toBe('OAI-Sites-Authorization')
    expect(DOT_REMOTE_SESSION_HEADER).toBe('Nash-Session')
    expect(DOT_REMOTE_OWNER_IDENTITY_HEADER).toBe('oai-authenticated-user-id')
  })

  it('has no token, authorization or secret field in any request body NASH sends', () => {
    const nashEndpoints = DOT_REMOTE_ENDPOINTS.filter((endpoint) => endpoint.caller === 'nash')
    expect(nashEndpoints.length).toBeGreaterThanOrEqual(10)
    for (const endpoint of nashEndpoints) {
      const names = propertyNames(z.toJSONSchema(dotRemoteEndpointSchemas(endpoint).request))
      expect(
        names.filter((name) => TOKEN_FIELD.test(name)),
        endpoint.name
      ).toEqual([])
    }
  })

  it('every NASH endpoint needs the service header; pairing has no session, refresh only the device credential', () => {
    const serviceOnly = ['pairing.challenge.create', 'pairing.session.issue']
    for (const endpoint of DOT_REMOTE_ENDPOINTS.filter((entry) => entry.caller === 'nash')) {
      const expected = serviceOnly.includes(endpoint.name)
        ? ['service']
        : endpoint.name === 'pairing.session.refresh'
          ? ['service', 'device_credential']
          : ['service', 'session']
      expect(endpoint.auth, endpoint.name).toEqual(expected)
    }
    const owner = DOT_REMOTE_ENDPOINTS.filter((endpoint) => endpoint.caller === 'owner')
    expect(owner.map((endpoint) => endpoint.name)).toEqual([
      'pairing.approve',
      'pairing.owner.revoke'
    ])
    for (const endpoint of owner) {
      expect(endpoint.auth, endpoint.name).toEqual(['owner_identity'])
    }
  })

  it('issues a short-lived single-use challenge with a code for the owner', () => {
    const challenge = {
      challengeId: CHALLENGE_ID,
      userCode: 'BCDF-GHJK',
      deviceCode: FAKE_DEVICE_CODE,
      expiresAt: '2026-10-05T12:10:00.000Z',
      pollIntervalSeconds: 5
    }
    expect(DotRemoteChallengeSchema.safeParse(challenge).success).toBe(true)
    expect(
      DotRemoteChallengeSchema.safeParse({ ...challenge, userCode: 'abcd-1234' }).success
    ).toBe(false)
    expect(DotRemoteChallengeSchema.safeParse({ ...challenge, deviceCode: 'short' }).success).toBe(
      false
    )
  })

  it('takes no identity from client labels or body fields', () => {
    expect(DotRemoteChallengeCreateRequestSchema.safeParse({ appVersion: '1.4.0' }).success).toBe(
      true
    )
    for (const label of [{ deviceName: 'My PC' }, { ownerId: 'u1' }, { client: { name: 'dot' } }]) {
      expect(
        DotRemoteChallengeCreateRequestSchema.safeParse({ appVersion: '1.4.0', ...label }).success
      ).toBe(false)
    }
    const issue = { challengeId: CHALLENGE_ID, deviceCode: FAKE_DEVICE_CODE }
    expect(DotRemoteSessionIssueRequestSchema.safeParse(issue).success).toBe(true)
    expect(
      DotRemoteSessionIssueRequestSchema.safeParse({ ...issue, deviceId: 'dev_x' }).success
    ).toBe(false)
  })

  it('binds owner, device, dot identity and generation on the server', () => {
    const shape = DotRemotePairingBindingSchema.shape
    expect(Object.keys(shape).sort()).toEqual(
      [
        'createdAt',
        'deviceId',
        'dotIdentity',
        'generation',
        'lifetimeEndsAt',
        'ownerId',
        'revokedAt'
      ].sort()
    )
    const binding = {
      ownerId: 'owner-fixture-0001',
      deviceId: 'dev_0123456789abcdef01234567',
      dotIdentity: { source: 'sites_mcp_identity', subject: 'owner-fixture-0001' },
      generation: 1,
      createdAt: T0,
      lifetimeEndsAt: '2026-11-04T12:00:00.000Z',
      revokedAt: null
    }
    expect(DotRemotePairingBindingSchema.safeParse(binding).success).toBe(true)
    const labelled = { ...binding, dotIdentity: { source: 'client_name', subject: 'dot' } }
    expect(DotRemotePairingBindingSchema.safeParse(labelled).success).toBe(false)
  })

  it('answers a session request as pending or issued', () => {
    const pending = { state: 'pending', pollIntervalSeconds: 5 }
    expect(DotRemoteSessionIssueResponseSchema.safeParse(pending).success).toBe(true)
    const issued = {
      state: 'issued',
      session: {
        sessionToken: 'FIXTUREsessionToken0000000000000000000000001',
        expiresAt: '2026-10-05T12:15:00.000Z',
        renewAfter: '2026-10-05T12:10:00.000Z',
        deviceId: 'dev_0123456789abcdef01234567',
        generation: 1
      },
      deviceCredential: {
        credential: FAKE_DEVICE_CREDENTIAL,
        expiresAt: '2026-11-04T12:00:00.000Z'
      }
    }
    expect(DotRemoteSessionIssueResponseSchema.safeParse(issued).success).toBe(true)
    const { deviceCredential: _credential, ...withoutCredential } = issued
    expect(DotRemoteSessionIssueResponseSchema.safeParse(withoutCredential).success).toBe(false)
    expect(DotRemoteSessionRenewRequestSchema.safeParse({ generation: 1 }).success).toBe(true)
    expect(
      DotRemoteSessionRenewRequestSchema.safeParse({ generation: 1, deviceId: 'x' }).success
    ).toBe(false)
  })
})

describe('heartbeat and workspace list', () => {
  it('reports NASH online with its app and contract version', () => {
    const heartbeat = { generation: 1, appVersion: '1.4.0', contractVersion: 3, sentAt: T0 }
    expect(DotRemoteHeartbeatRequestSchema.safeParse(heartbeat).success).toBe(true)
    expect(
      DotRemoteHeartbeatRequestSchema.safeParse({ ...heartbeat, contractVersion: 1 }).success
    ).toBe(false)
  })

  it('publishes opaque dws_ refs with display names, never paths', () => {
    const list = (workspaces: unknown[]) => ({ generation: 1, publishedAt: T0, workspaces })
    const docs = { workspaceRef: 'dws_0123456789abcdef01234567', displayName: 'Docs site' }
    expect(DotRemoteWorkspaceListRequestSchema.safeParse(list([docs])).success).toBe(true)
    const pathName = { ...docs, displayName: 'C:\\work\\docs' }
    expect(DotRemoteWorkspaceListRequestSchema.safeParse(list([pathName])).success).toBe(false)
    const pathRef = { ...docs, workspaceRef: 'C:/work/docs' }
    expect(DotRemoteWorkspaceListRequestSchema.safeParse(list([pathRef])).success).toBe(false)
    const withPath = { ...docs, path: 'C:/work/docs' }
    expect(DotRemoteWorkspaceListRequestSchema.safeParse(list([withPath])).success).toBe(false)
    expect(DotRemoteWorkspaceListRequestSchema.safeParse(list([docs, docs])).success).toBe(false)
  })

  it('shows dot whether NASH is paired and online, never online without a last-seen time', () => {
    const status = {
      paired: true,
      online: true,
      lastSeenAt: T0,
      appVersion: '1.4.0',
      contractVersion: 3,
      onlineWindowSeconds: 90,
      manifestSha256: 'a'.repeat(64)
    }
    expect(DotRemoteStatusViewSchema.safeParse(status).success).toBe(true)
    const never = {
      ...status,
      online: true,
      lastSeenAt: null,
      appVersion: null,
      contractVersion: null
    }
    expect(DotRemoteStatusViewSchema.safeParse(never).success).toBe(false)
  })
})
