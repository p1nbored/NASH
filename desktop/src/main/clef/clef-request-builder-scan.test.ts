import { afterEach, describe, expect, it, vi } from 'vitest'
import { scanClefContent } from './clef-content-scan'
import type * as ClefContentScanModule from './clef-content-scan'
import { buildClefRequest } from './clef-request-builder'
import { CLEF_RAW_INTAKE_MAX_CHARS, CLEF_STATE_DATA_CLASS } from './clef-state-builder'

vi.mock('./clef-content-scan', async (importOriginal) => {
  const actual = await importOriginal<typeof ClefContentScanModule>()
  return { ...actual, scanClefContent: vi.fn(actual.scanClefContent) }
})

const scan = vi.mocked(scanClefContent)

afterEach(() => {
  scan.mockClear()
})

describe('buildClefRequest content scan', () => {
  it('scans the raw TaskSpec and then every string of the built state', () => {
    const result = buildClefRequest({
      objective: '  Add a retry button.\r\n',
      acceptanceCriteria: ['Tests pass. ']
    })
    expect(result.ok).toBe(true)
    expect(scan.mock.calls).toEqual([
      [['  Add a retry button.\r\n', 'Tests pass. ']],
      [['Add a retry button.', 'Tests pass.', CLEF_STATE_DATA_CLASS]]
    ])
  })

  it('scans the agent_task_spec data class as part of the built state', () => {
    buildClefRequest({ objective: 'Add a retry button.' })
    expect(scan.mock.calls.at(-1)?.[0]).toContain('agent_task_spec')
  })

  it('blocks on a hit in the built state even when the raw TaskSpec scanned clean', () => {
    scan.mockImplementationOnce(() => ({ clean: true }))
    const result = buildClefRequest({ objective: 'Read /etc/hosts first.' })
    expect(result).toEqual({
      ok: false,
      blocker: { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      matchedRules: ['posix_absolute_path']
    })
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('scans a raw TaskSpec past the state caps whole, then the excerpt it sends (D-027)', () => {
    const objective = 'Plan the work. '.repeat(7_000)
    expect(buildClefRequest({ objective }).ok).toBe(true)
    expect(scan.mock.calls[0]?.[0]).toEqual([objective])
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('never scans raw intake past the TaskSpec ceiling', () => {
    buildClefRequest({ objective: 'a'.repeat(CLEF_RAW_INTAKE_MAX_CHARS + 1) })
    expect(scan).not.toHaveBeenCalled()
  })
})
