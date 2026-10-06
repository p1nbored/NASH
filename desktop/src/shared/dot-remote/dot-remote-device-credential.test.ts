import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { isEnglishText } from '../english-text'
import { DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS } from './dot-remote-defaults'
import {
  DOT_REMOTE_DEVICE_CREDENTIAL_HEADER,
  DotRemoteDeviceCredentialRecordSchema,
  DotRemoteDeviceCredentialSchema
} from './dot-remote-device-credential'
import { DOT_REMOTE_ENDPOINTS } from './dot-remote-endpoints'
import { DOT_REMOTE_ENDPOINT_ERROR_CODES, DOT_REMOTE_ERROR_MESSAGES } from './dot-remote-errors'
import { propertyNames } from './dot-remote-json-schema-walk.test-fixture'
import {
  DotRemoteSessionRefreshRequestSchema,
  DotRemoteSessionRefreshResponseSchema
} from './dot-remote-pairing'

const CREDENTIAL = 'ndc_000000000000000000000001.FIXTUREdeviceCredentialSecret00000000000000000001'
const SESSION = {
  sessionToken: 'FIXTUREsessionToken0000000000000000000000002',
  expiresAt: '2026-10-05T12:30:00.000Z',
  renewAfter: '2026-10-05T12:25:00.000Z',
  deviceId: 'dev_0123456789abcdef01234567',
  generation: 1
}
const GRANT = { credential: CREDENTIAL, expiresAt: '2026-11-04T12:00:15.000Z' }
const RECORD = {
  credentialId: 'ndc_000000000000000000000001',
  salt: 'FIXTUREsalt000000000001',
  secretHash: 'd'.repeat(64),
  ownerId: 'owner-fixture-0001',
  deviceId: 'dev_0123456789abcdef01234567',
  dotIdentity: { source: 'sites_mcp_identity', subject: 'owner-fixture-0001' },
  generation: 1,
  issuedAt: '2026-10-05T12:00:15.000Z',
  lifetimeEndsAt: '2026-11-04T12:00:15.000Z',
  supersededAt: null
}

describe('device credential (refresh-token style)', () => {
  it('travels only in the Nash-Device-Credential header, next to the service header', () => {
    expect(DOT_REMOTE_DEVICE_CREDENTIAL_HEADER).toBe('Nash-Device-Credential')
    const refresh = DOT_REMOTE_ENDPOINTS.find((entry) => entry.name === 'pairing.session.refresh')
    expect(refresh).toMatchObject({
      method: 'POST',
      path: '/nash/v1/session/refresh',
      caller: 'nash',
      auth: ['service', 'device_credential']
    })
  })

  it('never carries the credential in the refresh request body', () => {
    expect(Object.keys(DotRemoteSessionRefreshRequestSchema.shape)).toEqual(['generation'])
    const smuggled = { generation: 1, deviceCredential: CREDENTIAL }
    expect(DotRemoteSessionRefreshRequestSchema.safeParse(smuggled).success).toBe(false)
  })

  it('is an opaque id with a long random secret', () => {
    expect(DotRemoteDeviceCredentialSchema.safeParse(CREDENTIAL).success).toBe(true)
    const short = `${RECORD.credentialId}.${'a'.repeat(42)}`
    for (const value of [short, 'FIXTUREdeviceCredentialSecret00000000000000000001', 'ndc_1.x']) {
      expect(DotRemoteDeviceCredentialSchema.safeParse(value).success, value).toBe(false)
    }
  })

  it('refresh answers a new session and a rotated credential', () => {
    const response = { session: SESSION, deviceCredential: GRANT }
    expect(DotRemoteSessionRefreshResponseSchema.safeParse(response).success).toBe(true)
    expect(DotRemoteSessionRefreshResponseSchema.safeParse({ session: SESSION }).success).toBe(
      false
    )
  })

  it('is stored only as a salted hash bound to owner, device, dot identity and generation', () => {
    expect(Object.keys(DotRemoteDeviceCredentialRecordSchema.shape).sort()).toEqual(
      [
        'credentialId',
        'deviceId',
        'dotIdentity',
        'generation',
        'issuedAt',
        'lifetimeEndsAt',
        'ownerId',
        'salt',
        'secretHash',
        'supersededAt'
      ].sort()
    )
    expect(DotRemoteDeviceCredentialRecordSchema.safeParse(RECORD).success).toBe(true)
    const withSecret = { ...RECORD, credential: CREDENTIAL }
    expect(DotRemoteDeviceCredentialRecordSchema.safeParse(withSecret).success).toBe(false)
    const names = propertyNames(z.toJSONSchema(DotRemoteDeviceCredentialRecordSchema))
    expect(names.filter((name) => /^(credential|secret|token)$/i.test(name))).toEqual([])
  })

  it('ends the pairing after an absolute lifetime of 30 days, awaiting the user', () => {
    expect(DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS).toBe(30)
  })

  it('has fixed English refusals for an invalid, reused or expired credential', () => {
    const codes = ['device_credential_invalid', 'device_credential_reused', 'pairing_expired']
    for (const code of codes) {
      expect(DOT_REMOTE_ENDPOINT_ERROR_CODES, code).toContain(code)
    }
    const refresh = DOT_REMOTE_ENDPOINTS.find((entry) => entry.name === 'pairing.session.refresh')
    expect(refresh?.errors).toEqual(
      expect.arrayContaining([...codes, 'generation_revoked', 'payload_invalid'])
    )
    for (const message of Object.values(DOT_REMOTE_ERROR_MESSAGES)) {
      expect(isEnglishText(message), message).toBe(true)
    }
  })
})
