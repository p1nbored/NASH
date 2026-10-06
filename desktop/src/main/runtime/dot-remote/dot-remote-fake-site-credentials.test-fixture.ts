// FIXTURE_ONLY: the fake Site's device credentials, following R2's deviceCredential rule. Values are
// obviously synthetic (`ndc_` + a counter + a FIXTURE secret) and are never real credentials.
import { DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS } from '../../../shared/dot-remote/dot-remote-defaults'

const DAY_MS = 86_400_000

export type FakeRefreshOutcome =
  | { kind: 'rotated'; credential: string }
  | { kind: 'error'; code: FakeRefreshErrorCode; revoke: boolean }

type FakeRefreshErrorCode =
  | 'device_credential_invalid'
  | 'device_credential_reused'
  | 'pairing_expired'
  | 'generation_revoked'

type Held = { readonly value: string; readonly superseded: boolean }

export function createFakeDeviceCredentials(now: () => number) {
  let sequence = 0
  let held: Held[] = []
  let lifetimeEndsAt = 0
  const presented: string[] = []

  function mint(): string {
    sequence += 1
    const id = String(sequence).padStart(24, '0')
    return `ndc_${id}.FIXTUREdeviceCredentialSecret${String(sequence).padStart(20, '0')}`
  }

  function rotate(): string {
    const next = mint()
    held = [
      ...held.map((entry) => ({ ...entry, superseded: true })),
      { value: next, superseded: false }
    ]
    return next
  }

  return {
    /** A new pairing: one fresh credential and a new lifetime. */
    issue(): { credential: string; expiresAt: string } {
      lifetimeEndsAt = now() + DOT_REMOTE_DEVICE_CREDENTIAL_LIFETIME_DAYS * DAY_MS
      held = []
      return { credential: rotate(), expiresAt: new Date(lifetimeEndsAt).toISOString() }
    },
    /** R2's order: unknown, then revoked or wrong generation, then reuse, then lifetime. */
    refresh(value: string | null, generationMatches: boolean): FakeRefreshOutcome {
      presented.push(value ?? '')
      const entry = held.find((candidate) => candidate.value === value)
      if (!entry) {
        return { kind: 'error', code: 'device_credential_invalid', revoke: false }
      }
      if (!generationMatches) {
        return { kind: 'error', code: 'generation_revoked', revoke: false }
      }
      if (entry.superseded) {
        return { kind: 'error', code: 'device_credential_reused', revoke: true }
      }
      if (now() >= lifetimeEndsAt) {
        return { kind: 'error', code: 'pairing_expired', revoke: false }
      }
      return { kind: 'rotated', credential: rotate() }
    },
    lifetimeEndsAt: () => lifetimeEndsAt,
    expired: () => now() >= lifetimeEndsAt,
    expiresAt: () => new Date(lifetimeEndsAt).toISOString(),
    /** Someone else refreshed with the stored credential, so the one NASH holds is superseded. */
    rotateBehindNash: () => {
      rotate()
    },
    /** The Site lost every credential record. */
    forget: () => {
      held = []
    },
    current: () => held.find((entry) => !entry.superseded)?.value ?? null,
    presented
  }
}

export type FakeDeviceCredentials = ReturnType<typeof createFakeDeviceCredentials>
