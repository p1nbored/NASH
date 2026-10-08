import { describe, expect, it } from 'vitest'
import { DOT_REQUEST_ACCESS_LEVELS } from '../dot-ingress/dot-ingress-limits'
import {
  DOT_REMOTE_ALLOWED_SUBMIT_ACCESS,
  DOT_REMOTE_DECIDED_POLICY,
  DOT_REMOTE_DEFAULTS_AWAITING_CONFIRMATION,
  DOT_REMOTE_DELIVERABLE_CONTENTS_SENT,
  DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS,
  DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED,
  DOT_REMOTE_RETENTION_DAYS,
  DOT_REMOTE_SUBMIT_ACCESS_CAP,
  DOT_REMOTE_SUBMIT_TTL_MINUTES,
  dotRemoteAccessLevelsUpTo
} from './dot-remote-defaults'

describe('dot remote defaults and decisions (plan section 10)', () => {
  it('keeps the recommended value of each open decision', () => {
    expect(DOT_REMOTE_DELIVERABLE_CONTENTS_SENT).toBe(false)
    expect(DOT_REMOTE_SUBMIT_TTL_MINUTES).toBe(30)
    expect(DOT_REMOTE_RETENTION_DAYS).toBe(7)
    expect(DOT_REMOTE_PERMISSION_ANSWERS_ALLOWED).toBe(true)
    expect(DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS).toBe(30)
  })

  it('marks every remaining default as awaiting the user', () => {
    expect(DOT_REMOTE_DEFAULTS_AWAITING_CONFIRMATION).toEqual({
      status: 'awaiting_user_confirmation',
      deliverableContentsSent: false,
      submitTtlMinutes: 30,
      retentionDays: 7,
      permissionAnswersAllowed: true,
      deviceCredentialLifetimeDays: 30
    })
  })

  it('lets remote submissions ask for workspace write, as the user decided (D-034)', () => {
    expect(DOT_REMOTE_SUBMIT_ACCESS_CAP).toBe('workspace_write')
    expect(DOT_REMOTE_DECIDED_POLICY).toEqual({ submitAccessCap: 'workspace_write' })
    expect(DOT_REMOTE_ALLOWED_SUBMIT_ACCESS).toEqual(['read_only', 'workspace_write'])
  })

  it('derives the remote access levels from the cap and never goes above it', () => {
    expect(dotRemoteAccessLevelsUpTo('read_only')).toEqual(['read_only'])
    expect(dotRemoteAccessLevelsUpTo('workspace_write')).toEqual([...DOT_REQUEST_ACCESS_LEVELS])
  })
})
