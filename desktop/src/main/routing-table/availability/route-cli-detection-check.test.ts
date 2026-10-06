import { describe, expect, it } from 'vitest'
import { cliCheckOf, readAgentDetection } from './route-cli-detection-check'

function sources(overrides: {
  detected?: () => Promise<readonly string[]>
  disabled?: () => Iterable<unknown> | null | undefined
}) {
  return {
    detectInstalled: overrides.detected ?? (async () => ['claude', 'codex', 'antigravity']),
    disabled: overrides.disabled ?? (() => [])
  }
}

describe('readAgentDetection and cliCheckOf', () => {
  it('passes for an installed, enabled agent, using agy`s detection id antigravity', async () => {
    const reading = await readAgentDetection(sources({}))
    expect(cliCheckOf(reading, 'claude')).toEqual({
      check: 'cli',
      result: 'pass',
      evidence: { agent: 'claude' }
    })
    expect(cliCheckOf(reading, 'agy')).toMatchObject({
      result: 'pass',
      evidence: { agent: 'antigravity' }
    })
  })

  it('fails as cli_missing when detection does not report the agent', async () => {
    const reading = await readAgentDetection(sources({ detected: async () => ['claude'] }))
    expect(cliCheckOf(reading, 'codex')).toMatchObject({
      check: 'cli',
      result: 'fail',
      reason: 'cli_missing'
    })
  })

  it('fails as cli_disabled when the user turned an installed agent off', async () => {
    const reading = await readAgentDetection(sources({ disabled: () => ['codex'] }))
    expect(cliCheckOf(reading, 'codex')).toMatchObject({ result: 'fail', reason: 'cli_disabled' })
    expect(cliCheckOf(reading, 'claude')).toMatchObject({ result: 'pass' })
  })

  it('reports a missing agent as missing even when it is also disabled', async () => {
    const reading = await readAgentDetection(
      sources({ detected: async () => [], disabled: () => ['codex'] })
    )
    expect(cliCheckOf(reading, 'codex')).toMatchObject({ reason: 'cli_missing' })
  })

  it('treats an absent disabled setting as nothing disabled', async () => {
    for (const disabled of [() => null, () => undefined]) {
      const reading = await readAgentDetection(sources({ disabled }))
      expect(cliCheckOf(reading, 'claude')).toMatchObject({ result: 'pass' })
    }
  })

  it('ignores identifiers that are not known agents', async () => {
    const reading = await readAgentDetection(sources({ detected: async () => ['not-an-agent'] }))
    expect(reading.ok && reading.installed.size).toBe(0)
  })

  it('fails closed when the disabled setting cannot be read: unobserved, never offered', async () => {
    const reading = await readAgentDetection(
      sources({
        disabled: () => {
          throw new Error('settings unreadable')
        }
      })
    )
    expect(reading).toEqual({ ok: false })
    expect(cliCheckOf(reading, 'claude')).toMatchObject({
      check: 'cli',
      result: 'unobserved',
      reason: 'cli_unobserved'
    })
  })

  it('is unobserved when detection itself fails', async () => {
    const reading = await readAgentDetection(
      sources({
        detected: async () => {
          throw new Error('detection failed')
        }
      })
    )
    expect(reading).toEqual({ ok: false })
  })
})
