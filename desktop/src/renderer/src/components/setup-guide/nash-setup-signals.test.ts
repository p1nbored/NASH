import { describe, expect, it } from 'vitest'
import {
  hasWorkbenchRun,
  isClaudeCodeDetected,
  isClefConnected,
  isDotConnected
} from './nash-setup-signals'
import { fixturePinnedProfile, fixtureStatus } from '../settings/clef-verification.test-fixture'
import {
  fixtureDotSettings,
  fixtureListeningDotSettings
} from '../settings/dot-ingress-settings.test-fixture'
import {
  fixtureConnectedRemoteStatus,
  fixtureRemoteStatus
} from '../settings/dot-remote-access.test-fixture'
import { runList, runView } from '../right-sidebar/workbench-run-test-fixture'

describe('NASH onboarding signals (D-038)', () => {
  it('detects Claude Code from the agents found on PATH', () => {
    expect(isClaudeCodeDetected(['codex', 'claude'])).toBe(true)
    expect(isClaudeCodeDetected(['codex'])).toBe(false)
    expect(isClaudeCodeDetected(null)).toBe(false)
  })

  it('counts Clef as connected only after its profile is verified and pinned', () => {
    expect(isClefConnected(fixtureStatus({ status: 'not_configured' }))).toBe(false)
    expect(isClefConnected(fixtureStatus({ status: 'contract_unverified' }))).toBe(false)
    expect(isClefConnected(fixtureStatus({ status: 'identity_unpinned' }))).toBe(false)
    expect(isClefConnected(fixtureStatus({ status: 'auth_failed' }))).toBe(false)
    const verified = { profile: fixturePinnedProfile() }
    expect(isClefConnected(fixtureStatus({ ...verified, status: 'ready' }))).toBe(true)
    expect(isClefConnected(fixtureStatus({ ...verified, status: 'unreachable' }))).toBe(true)
    expect(isClefConnected({ status: 'ready' })).toBe(false)
  })

  it('counts dot as connected when the local interface is on or a Site is paired', () => {
    expect(isDotConnected(fixtureDotSettings(), fixtureRemoteStatus())).toBe(false)
    expect(isDotConnected(fixtureListeningDotSettings(), null)).toBe(true)
    expect(isDotConnected(null, fixtureConnectedRemoteStatus())).toBe(true)
    expect(isDotConnected(undefined, undefined)).toBe(false)
  })

  it('counts the first Workbench run once one exists', () => {
    expect(hasWorkbenchRun(runList())).toBe(false)
    expect(hasWorkbenchRun(runList([runView()]))).toBe(true)
    expect(hasWorkbenchRun({ runs: 'nope' })).toBe(false)
  })
})
