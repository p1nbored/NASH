import { describe, expect, it } from 'vitest'
import { DOT_REQUEST_ACCESS_LEVELS } from '../dot-ingress/dot-ingress-limits'
import {
  DOT_REMOTE_ALLOWED_SUBMIT_ACCESS,
  DOT_REMOTE_DEFAULTS_AWAITING_CONFIRMATION,
  DOT_REMOTE_DELIVERABLE_CONTENTS_SENT,
  DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS,
  DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED,
  DOT_REMOTE_RETENTION_DAYS,
  DOT_REMOTE_SUBMIT_ACCESS_CAP,
  DOT_REMOTE_SUBMIT_TTL_MINUTES,
  dotRemoteAccessLevelsUpTo
} from './dot-remote-defaults'

describe('dot remote defaults awaiting the user (plan section 10)', () => {
  it('keeps the recommended value of each decision', () => {
    expect(DOT_REMOTE_DELIVERABLE_CONTENTS_SENT).toBe(false)
    expect(DOT_REMOTE_SUBMIT_ACCESS_CAP).toBe('read_only')
    expect(DOT_REMOTE_SUBMIT_TTL_MINUTES).toBe(30)
    expect(DOT_REMOTE_RETENTION_DAYS).toBe(7)
    expect(DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED).toBe(true)
    expect(DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS).toBe(30)
  })

  it('marks every default as awaiting the user', () => {
    expect(DOT_REMOTE_DEFAULTS_AWAITING_CONFIRMATION).toEqual({
      status: 'awaiting_user_confirmation',
      deliverableContentsSent: false,
      submitAccessCap: 'read_only',
      submitTtlMinutes: 30,
      retentionDays: 7,
      permissionAnswersAllowed: true,
      deviceCredentialLifetimeDays: 30
    })
  })

  it('derives the remote access levels from the cap and never goes above it', () => {
    expect(DOT_REMOTE_ALLOWED_SUBMIT_ACCESS).toEqual(['read_only'])
    expect(dotRemoteAccessLevelsUpTo('read_only')).toEqual(['read_only'])
    expect(dotRemoteAccessLevelsUpTo('workspace_write')).toEqual([...DOT_REQUEST_ACCESS_LEVELS])
  })
})
