import { describe, expect, it } from 'vitest'
import { CLEF_STATE_DATA_CLASS } from '../../clef/clef-state-builder'
import {
  G1_ALLOWED_DATA_CLASSES,
  evaluateConfigurationGate,
  evaluateDataBoundaryGate,
  evaluateRequestGates,
  type ConfigurationGateSnapshot,
  type DataBoundaryGateSnapshot
} from './routing-gates'

const configured: ConfigurationGateSnapshot = {
  credentials: 'sealed',
  verifiedProfilePresent: true,
  responseModelPinned: true
}

const clean: DataBoundaryGateSnapshot = {
  contentScan: { clean: true },
  objectiveIsEnglish: true,
  dataClass: 'agent_task_spec'
}

describe('G0 configuration gate', () => {
  it('passes when sealed credentials, profile and model pin are present, with no spend cap (D-022)', () => {
    expect(evaluateConfigurationGate(configured)).toEqual({ passed: true })
  })

  it.each([
    ['missing', 'not_configured'],
    ['not_sealed', 'not_configured'],
    ['sealing_unavailable', 'sealing_unavailable']
  ] as const)('blocks %s credentials as not_configured with status %s', (credentials, status) => {
    expect(evaluateConfigurationGate({ ...configured, credentials })).toEqual({
      passed: false,
      gate: 'G0',
      blocker: { reason: 'classifier_unavailable', detail: 'not_configured' },
      routingStatus: status
    })
  })

  it('blocks a missing verified profile as contract_unverified', () => {
    expect(evaluateConfigurationGate({ ...configured, verifiedProfilePresent: false })).toEqual({
      passed: false,
      gate: 'G0',
      blocker: { reason: 'classifier_unavailable', detail: 'contract_unverified' },
      routingStatus: 'contract_unverified'
    })
  })

  it('blocks an unpinned response model as clef_identity_unpinned', () => {
    expect(evaluateConfigurationGate({ ...configured, responseModelPinned: false })).toEqual({
      passed: false,
      gate: 'G0',
      blocker: { reason: 'classifier_unavailable', detail: 'clef_identity_unpinned' },
      routingStatus: 'identity_unpinned'
    })
  })

  it('reports the first failing check in pinned order', () => {
    const nothing: ConfigurationGateSnapshot = {
      credentials: 'missing',
      verifiedProfilePresent: false,
      responseModelPinned: false
    }
    const result = evaluateConfigurationGate(nothing)
    expect(result.passed === false && result.blocker.detail).toBe('not_configured')
    const noProfile = evaluateConfigurationGate({ ...nothing, credentials: 'sealed' })
    expect(noProfile.passed === false && noProfile.blocker.detail).toBe('contract_unverified')
    const noPin = evaluateConfigurationGate({
      ...nothing,
      credentials: 'sealed',
      verifiedProfilePresent: true
    })
    expect(noPin.passed === false && noPin.blocker.detail).toBe('clef_identity_unpinned')
  })
})

describe('G1 data boundary gate', () => {
  it('passes a clean English agent TaskSpec', () => {
    expect(evaluateDataBoundaryGate(clean)).toEqual({ passed: true })
  })

  it('allows the agent_task_spec data class and no other, user_task_summary included', () => {
    expect(G1_ALLOWED_DATA_CLASSES).toEqual(['agent_task_spec'])
    // Why: the gate keeps its own list, so a change to the state builder's class cannot widen it silently.
    expect(G1_ALLOWED_DATA_CLASSES).toContain(CLEF_STATE_DATA_CLASS)
    expect(evaluateDataBoundaryGate({ ...clean, dataClass: 'user_task_summary' })).toEqual({
      passed: false,
      gate: 'G1',
      blocker: { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      matchedRule: null
    })
  })

  it('blocks a content scan hit and records only the rule id', () => {
    const result = evaluateDataBoundaryGate({
      ...clean,
      contentScan: { clean: false, matchedRule: 'bearer_token' }
    })
    expect(result).toEqual({
      passed: false,
      gate: 'G1',
      blocker: { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      matchedRule: 'bearer_token'
    })
  })

  it('blocks a non-English objective as missing_inputs', () => {
    expect(evaluateDataBoundaryGate({ ...clean, objectiveIsEnglish: false })).toEqual({
      passed: false,
      gate: 'G1',
      blocker: { reason: 'missing_inputs', detail: 'non_english_objective' },
      matchedRule: null
    })
  })

  it('blocks a data class that is not on the allowed list', () => {
    expect(evaluateDataBoundaryGate({ ...clean, dataClass: 'source_code' })).toEqual({
      passed: false,
      gate: 'G1',
      blocker: { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      matchedRule: null
    })
  })

  it('checks the content scan before the English check', () => {
    const result = evaluateDataBoundaryGate({
      contentScan: { clean: false, matchedRule: 'email_address' },
      objectiveIsEnglish: false,
      dataClass: 'other'
    })
    expect(result.passed === false && result.blocker.detail).toBe('data_boundary_forbids')
  })
})

describe('request gates', () => {
  it('runs G0 before G1 and passes when both pass', () => {
    expect(evaluateRequestGates({ ...configured, ...clean })).toEqual({ passed: true })
    const both = evaluateRequestGates({
      ...configured,
      ...clean,
      responseModelPinned: false,
      objectiveIsEnglish: false
    })
    expect(both.passed === false && both.gate).toBe('G0')
    const g1 = evaluateRequestGates({ ...configured, ...clean, objectiveIsEnglish: false })
    expect(g1.passed === false && g1.gate).toBe('G1')
  })
})
