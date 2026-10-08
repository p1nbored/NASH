import { describe, expect, it } from 'vitest'
import {
  getCurrentSetupScriptProbeState,
  getSetupGuideProgressReady,
  getSetupScriptProbeSignature,
  markSetupScriptProbePending,
  settleSetupScriptProbe
} from './setup-guide-progress-readiness'

describe('getSetupGuideProgressReady', () => {
  const readyInput = {
    refreshEnabled: true,
    settingsLoaded: true,
    preflightStatusChecked: true,
    linearStatusChecked: true,
    jiraStatusChecked: true,
    setupScriptProbeReady: true,
    nashSignalsChecked: true
  }

  it('is ready once every probe has answered', () => {
    expect(getSetupGuideProgressReady(readyInput)).toBe(true)
  })

  it('waits for the NASH signals (Claude Code, Clef, dot, Workbench runs)', () => {
    expect(getSetupGuideProgressReady({ ...readyInput, nashSignalsChecked: false })).toBe(false)
  })

  it('waits for preflight, Linear, and Jira checks', () => {
    expect(getSetupGuideProgressReady({ ...readyInput, preflightStatusChecked: false })).toBe(false)
    expect(getSetupGuideProgressReady({ ...readyInput, linearStatusChecked: false })).toBe(false)
    expect(getSetupGuideProgressReady({ ...readyInput, jiraStatusChecked: false })).toBe(false)
  })
})

describe('setup script probe readiness', () => {
  it('derives the probe signature from runtime and ordered git repo inputs', () => {
    const localSignature = getSetupScriptProbeSignature({ activeRuntimeEnvironmentId: null }, [
      { id: 'repo-a', hookSettings: undefined },
      { id: 'repo-b', hookSettings: undefined }
    ])
    const remoteSignature = getSetupScriptProbeSignature(
      { activeRuntimeEnvironmentId: 'runtime-1' },
      [
        { id: 'repo-a', hookSettings: undefined },
        { id: 'repo-b', hookSettings: undefined }
      ]
    )
    const reorderedSignature = getSetupScriptProbeSignature({ activeRuntimeEnvironmentId: null }, [
      { id: 'repo-b', hookSettings: undefined },
      { id: 'repo-a', hookSettings: undefined }
    ])

    expect(localSignature).not.toBeNull()
    expect(remoteSignature).not.toBe(localSignature)
    expect(reorderedSignature).not.toBe(localSignature)
  })

  it('resets readiness on setup-script generation changes and ignores late older results', () => {
    const firstSignature = 'runtime:local|repo-a'
    const secondSignature = 'runtime:local|repo-b'
    const firstReady = settleSetupScriptProbe(
      markSetupScriptProbePending(
        { signature: null, ready: false, hasSetupScript: false },
        firstSignature
      ),
      firstSignature,
      true
    )

    expect(firstReady).toEqual({
      signature: firstSignature,
      ready: true,
      hasSetupScript: true
    })

    const secondPending = markSetupScriptProbePending(firstReady, secondSignature)
    expect(secondPending).toEqual({
      signature: secondSignature,
      ready: false,
      hasSetupScript: false
    })
    expect(getCurrentSetupScriptProbeState(firstReady, secondSignature)).toEqual(secondPending)
    expect(settleSetupScriptProbe(secondPending, firstSignature, true)).toBe(secondPending)
  })

  it('settles setup-script failures as ready with no setup script', () => {
    const signature = 'runtime:local|repo-a'
    const pending = markSetupScriptProbePending(
      { signature: null, ready: false, hasSetupScript: false },
      signature
    )

    expect(settleSetupScriptProbe(pending, signature, false)).toEqual({
      signature,
      ready: true,
      hasSetupScript: false
    })
  })

  it('allows late positive setup-script results to update after timeout settlement', () => {
    const signature = 'runtime:local|repo-a'
    const timedOut = {
      signature,
      ready: true,
      hasSetupScript: false
    }

    expect(settleSetupScriptProbe(timedOut, signature, true)).toEqual({
      signature,
      ready: true,
      hasSetupScript: true
    })
  })
})
