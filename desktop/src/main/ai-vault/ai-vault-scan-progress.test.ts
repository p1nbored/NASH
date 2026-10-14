import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AI_VAULT_SCAN_PROGRESS_INTERVAL_MS,
  noteAiVaultScanProgress,
  trackAiVaultScanProgress
} from './ai-vault-scan-progress'
import { scanAiVaultSessions } from './session-scanner'
import { consumeCompleteJsonlLines } from './session-scanner-jsonl-reader'
import { resetSessionParseCacheForTests } from './session-scanner-parse-cache'
import { isolatedScanRoots, writeJsonlFile } from './session-scanner-test-fixtures'

let tempRoots: string[] = []

afterEach(async () => {
  resetSessionParseCacheForTests()
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })))
  tempRoots = []
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-scan-progress-'))
  tempRoots.push(root)
  return root
}

/** A clock that has always moved a full interval, so every advance is reported. */
function steppingClock(): () => number {
  let now = 0
  return () => (now += AI_VAULT_SCAN_PROGRESS_INTERVAL_MS)
}

describe('scan progress reporting', () => {
  it('reports at most once per interval, and only after the counter moved', () => {
    let now = 0
    const reports: number[] = []
    const controller = new AbortController()
    const stop = trackAiVaultScanProgress(
      controller.signal,
      (units) => reports.push(units),
      () => now
    )

    noteAiVaultScanProgress(controller.signal)
    noteAiVaultScanProgress(controller.signal)
    now += AI_VAULT_SCAN_PROGRESS_INTERVAL_MS - 1
    noteAiVaultScanProgress(controller.signal)
    expect(reports).toEqual([1])

    // Time alone is not progress: nothing is sent until work advances again.
    now += 60_000
    expect(reports).toEqual([1])
    noteAiVaultScanProgress(controller.signal)
    expect(reports).toEqual([1, 4])

    stop()
    now += 60_000
    noteAiVaultScanProgress(controller.signal)
    expect(reports).toEqual([1, 4])
  })

  it('never credits work done under another signal', () => {
    const reports: number[] = []
    const scan = new AbortController()
    trackAiVaultScanProgress(scan.signal, (units) => reports.push(units), steppingClock())

    noteAiVaultScanProgress(new AbortController().signal)
    noteAiVaultScanProgress(undefined)
    expect(reports).toEqual([])
  })

  it('counts every chunk a long transcript read consumes', async () => {
    const root = await tempRoot()
    const path = join(root, 'long.jsonl')
    const line = JSON.stringify({ text: 'x'.repeat(1_000) })
    await writeFile(path, `${Array.from({ length: 400 }, () => line).join('\n')}\n`)
    const reports: number[] = []
    const controller = new AbortController()
    trackAiVaultScanProgress(controller.signal, (units) => reports.push(units), steppingClock())

    await consumeCompleteJsonlLines({
      path,
      start: 0,
      onLine: () => undefined,
      signal: controller.signal
    })

    // ~400 KB arrives in several stream chunks; one unit per chunk.
    expect(reports.length).toBeGreaterThan(3)
    expect(reports).toEqual(reports.map((_, index) => index + 1))
  })

  it('reports discovery and parsing for its own scan, never for an unrelated one', async () => {
    const root = await tempRoot()
    const roots = isolatedScanRoots(root)
    for (const name of ['a', 'b', 'c']) {
      await writeJsonlFile(join(roots.claudeProjectsDir, 'project', `${name}.jsonl`), [
        {
          type: 'user',
          sessionId: name,
          timestamp: '2026-05-01T10:00:00.000Z',
          cwd: '/tmp/claude',
          message: { role: 'user', content: `ask ${name}` }
        }
      ])
    }
    const reports: number[] = []
    const tracked = new AbortController()
    trackAiVaultScanProgress(tracked.signal, (units) => reports.push(units), steppingClock())

    // Same readers, another owner's signal (the index loop or an interactive read).
    await scanAiVaultSessions({
      ...roots,
      platform: 'darwin',
      limit: 20,
      signal: new AbortController().signal
    })
    expect(reports).toEqual([])

    resetSessionParseCacheForTests()
    const result = await scanAiVaultSessions({
      ...roots,
      platform: 'darwin',
      limit: 20,
      signal: tracked.signal
    })
    expect(result.sessions).toHaveLength(3)
    // Two directory listings, a stat batch, then a chunk and a parse per file.
    expect(reports.length).toBeGreaterThanOrEqual(2 + 1 + 3 * 2)
    expect(reports).toEqual(reports.map((_, index) => index + 1))
  })
})
