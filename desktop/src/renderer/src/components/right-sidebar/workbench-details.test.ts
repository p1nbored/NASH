import { describe, expect, it } from 'vitest'
import { errorDetails, formatWorkbenchDetails } from './workbench-details'

describe('formatWorkbenchDetails', () => {
  it('writes one key: value line per entry under a fixed heading', () => {
    expect(
      formatWorkbenchDetails('run', [
        ['run_id', 'run-1'],
        ['request_id', 'request-1'],
        ['routing_table_version', 3]
      ])
    ).toBe(
      [
        'NASH Workbench: run',
        'run_id: run-1',
        'request_id: request-1',
        'routing_table_version: 3'
      ].join('\n')
    )
  })

  it('drops empty values and folds multi-line values onto one line', () => {
    expect(
      formatWorkbenchDetails('request', [
        ['request_id', 'request-1'],
        ['run_id', null],
        ['task_id', undefined],
        ['branch', '  '],
        ['error_message', 'first line\r\nsecond line\nthird']
      ])
    ).toBe(
      [
        'NASH Workbench: request',
        'request_id: request-1',
        'error_message: first line second line third'
      ].join('\n')
    )
  })
})

describe('errorDetails', () => {
  it('lists the code, any sub-code and the raw text, falling back to the shown sentence', () => {
    expect(
      errorDetails({
        code: 'workbench_run_stop_refused',
        reason: 'autopilot_owner_starting',
        message: 'The session is still starting.',
        detail: 'The session could not be stopped now. Nothing was changed.'
      })
    ).toEqual([
      ['error_code', 'workbench_run_stop_refused'],
      ['error_reason', 'autopilot_owner_starting'],
      ['error_message', 'The session could not be stopped now. Nothing was changed.']
    ])
    expect(errorDetails({ code: 'invalid_response', message: 'Unexpected.' }, 'stop')).toEqual([
      ['stop_error_code', 'invalid_response'],
      ['stop_error_reason', undefined],
      ['stop_error_message', 'Unexpected.']
    ])
    expect(errorDetails(null)).toEqual([])
  })
})

it('redacts runtime secrets before formatting clipboard details', () => {
  const result = formatWorkbenchDetails('run', [['error_message', 'Bearer abc123']])
  expect(result).not.toContain('abc123')
  expect(result).toContain('[redacted-secret]')
})
