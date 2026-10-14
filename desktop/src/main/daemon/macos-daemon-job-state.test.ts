import { beforeEach, expect, it, vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '@orca/process-host/process-spec'

const { run, clock } = vi.hoisted(() => ({
  run: vi.fn<(spec: ProcessSpec) => Promise<ProcessResult>>(),
  clock: { now: 0 }
}))
vi.mock('@orca/process-host', () => ({ runProcess: run }))
// Each poll wait advances a virtual clock, so the removal deadline runs without real time.
vi.mock('node:timers/promises', () => ({
  setTimeout: async (ms: number) => {
    clock.now += ms
  }
}))
import {
  readMacDaemonJobState,
  releaseMacDaemonJob,
  stopMacDaemonJob
} from './macos-daemon-job-state'

const result: ProcessResult = { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }
beforeEach(() => {
  run.mockReset()
  clock.now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now)
})

it.each([
  ['\tstate = running\n\t\tstate = active', 'running'],
  ['\tstate = not running\n\t\tstate = active', 'stopped'],
  ['\t\tstate = active', 'unverifiable']
])('reads only the top-level job state from %s', async (stdout, expected) => {
  run.mockResolvedValue({ ...result, stdout })
  expect(await readMacDaemonJobState('gui/501/owned')).toBe(expected)
})

it.each([
  { code: 113, stderr: 'Could not find service "owned"', expected: 'missing' },
  { code: 113, stderr: 'Could not find service; Permission denied', expected: 'unverifiable' },
  { code: 1, stderr: 'Could not find service "owned"', expected: 'unverifiable' },
  { code: 0, stdout: '\tstate = running', timedOut: true, expected: 'unverifiable' },
  { code: 0, stdout: '\tstate = running', outputTruncated: true, expected: 'unverifiable' }
])('preserves uncertainty for $expected', async ({ expected, ...override }) => {
  run.mockResolvedValue({ ...result, ...override })
  expect(await readMacDaemonJobState('gui/501/owned')).toBe(expected)
})

const missing = { ...result, code: 113, stderr: 'Could not find service "owned"' }
const lingering = { ...result, stdout: '\tstate = running' }

it('returns only once launchd no longer lists a job it was asked to remove', async () => {
  run
    .mockResolvedValueOnce(result)
    .mockResolvedValueOnce(lingering)
    .mockResolvedValueOnce(lingering)
    .mockResolvedValueOnce(missing)
  await expect(stopMacDaemonJob('gui/501/owned')).resolves.toBeUndefined()
  expect(run.mock.calls.map(([spec]) => spec.args?.[0])).toEqual([
    'bootout',
    'print',
    'print',
    'print'
  ])
})

it('accepts an already removed job but refuses one launchd keeps listing', async () => {
  run.mockResolvedValueOnce({ ...result, code: 3 }).mockResolvedValueOnce(missing)
  await expect(stopMacDaemonJob('gui/501/owned')).resolves.toBeUndefined()
  run.mockResolvedValue(lingering)
  await expect(stopMacDaemonJob('gui/501/owned')).rejects.toThrow('Could not stop')
})

it.each([
  ['missing', [missing], true],
  [
    'stopped and booted out',
    [{ ...result, stdout: '\tstate = not running' }, result, missing],
    true
  ],
  [
    'stopped but not booted out',
    [
      { ...result, stdout: '\tstate = not running' },
      { ...result, code: 1 },
      { ...result, code: 1 }
    ],
    false
  ],
  ['running', [{ ...result, stdout: '\tstate = running' }], false],
  ['unverifiable', [{ ...result, code: 1, stderr: 'Operation not permitted' }], false]
] as const)(
  'releases the label only when no process can start under it: %s',
  async (_, replies, released) => {
    for (const reply of replies) {
      run.mockResolvedValueOnce(reply)
    }
    expect(await releaseMacDaemonJob('gui/501/owned')).toBe(released)
  }
)
