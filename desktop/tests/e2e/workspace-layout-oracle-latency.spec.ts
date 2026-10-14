/**
 * Measures command → drawn update for layout commands, idle and with three panes flooding output
 * (`yes`), one of them in a hidden worktree, and time to first drawn after relaunching a large
 * profile. Measuring only: it records each number in the oracle report and never fails on one,
 * so a later budget can gate on it. Runs with no layout subscriber, so main is measured as users
 * run it. The committed main baseline is workspace-layout-oracle-latency-baseline.json.
 *
 * Each command is timed twice. The in-app clock (helpers/layout-latency-probe.ts) stops in the
 * window at React's commit and at the next frame. The outer clock stops when the test sees the
 * drawn result over CDP, so it also holds one DevTools round trip.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { bootstrapFirstLaunch, seededRepoPathOrSkip } from './helpers/terminal-restart-persistence'
import {
  focusActiveTerminalInput,
  splitActiveTerminalPane,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { resolveActiveTabId } from './helpers/terminal-pane-identity'
import { waitForBoundPanes } from './helpers/terminal-layout-journeys'
import { SORTABLE_TAB } from './helpers/terminal-tab-menu'
import { ORACLE_REPORT_DIR_ENV } from './helpers/workspace-layout-oracle-session'
import {
  armLayoutLatencyProbe,
  readLayoutLatencyProbe,
  type ArmOptions,
  type DrawnCondition,
  type InAppSample
} from './helpers/layout-latency-probe'
import { installFirstDrawnWatch, readFirstDrawn } from './helpers/first-drawn-watch'
import {
  summarizeEventLoopDelay,
  waitForEventLoopDelayWindow,
  type EventLoopDelaySummary
} from './helpers/event-loop-delay-report'
import { RuntimeClient } from '../../src/cli/runtime/client'
import type {
  RuntimeTerminalCreate,
  RuntimeTerminalListResult,
  RuntimeTerminalRead,
  RuntimeWorktreeCreateResult
} from '../../src/shared/runtime-types'
import type { RuntimeMobileSessionTabsResult } from '../../src/shared/runtime-session-contracts'

// The baseline is taken with 100; routine runs keep 10, since a Linux CI sample waits ~1 s per frame.
const SAMPLES = Number(process.env.ORCA_LAYOUT_ORACLE_LATENCY_SAMPLES ?? 10)
const STARTUP_SAMPLES = Number(process.env.ORCA_LAYOUT_ORACLE_STARTUP_SAMPLES ?? 10)
const FLOOD_COMMAND = 'yes orca-latency-flood'
const CLOSE_CONFIRM = 'Stop and Close'
const LARGE_PROFILE = { hiddenWorktrees: 12, tabsPerWorktree: 3, activePanes: 4 }

type Condition = 'idle' | 'flood'
type Sample = { outerMs: number; inApp: InAppSample }
type Samples = Record<string, Sample[]>

/** Reads can briefly fail while the window re-publishes its terminals; only reads are retried. */
async function read<T>(client: RuntimeClient, method: string, params: unknown): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    try {
      return (await client.call<T>(method, params)).result
    } catch (error) {
      if (Date.now() > deadline || !String(error).includes('unavailable')) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
}

function stats(values: number[]): { p50: number; p95: number; max: number } {
  const sorted = values.toSorted((a, b) => a - b)
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN
  return {
    p50: Math.round(at(50)),
    p95: Math.round(at(95)),
    max: Math.round(sorted.at(-1) ?? Number.NaN)
  }
}

/** Times one command on both clocks; null when it stopped on a confirmation. */
async function timeCommand(
  page: Page,
  condition: DrawnCondition,
  options: ArmOptions,
  send: () => Promise<unknown>
): Promise<Sample | null> {
  await armLayoutLatencyProbe(page, condition, options)
  const sentAt = Date.now()
  await send()
  const inApp = await readLayoutLatencyProbe(page, sentAt)
  return inApp ? { outerMs: Date.now() - sentAt, inApp } : null
}

/** The split helper's call, stamped in the window right before it runs. */
async function stampedSplit(page: Page): Promise<void> {
  const tabId = await resolveActiveTabId(page)
  await page.evaluate((tabId) => {
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    if (!manager?.splitPane || !pane || !window.__layoutLatencyProbe) {
      throw new Error('stampedSplit: active pane manager or probe not ready')
    }
    window.__layoutLatencyProbe.startedAt = Date.now()
    manager.splitPane(pane.id, 'vertical')
  }, tabId)
}

async function measureCondition(
  page: Page,
  client: RuntimeClient,
  worktreeId: string,
  condition: Condition,
  samples: Samples
): Promise<number> {
  const worktree = `id:${worktreeId}`
  const add = (action: string, sample: Sample | null): void => {
    if (!sample) {
      throw new Error(`${action} asked for confirmation`)
    }
    ;(samples[`${action} (${condition})`] ??= []).push(sample)
  }
  const sender: ArmOptions = { startOn: 'sender' }
  let confirms = 0
  for (let index = 0; index < SAMPLES; index += 1) {
    add(
      'split',
      await timeCommand(page, { kind: 'panes', count: 2 }, sender, () => stampedSplit(page))
    )
    await waitForBoundPanes(page, 2)
    // A fresh shell can still read as busy and ask first; retry so close pane gets SAMPLES too.
    for (;;) {
      await focusActiveTerminalInput(page)
      const closed = await timeCommand(
        page,
        { kind: 'panes', count: 1 },
        { startOn: 'keydown', confirmButton: CLOSE_CONFIRM },
        () => page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w')
      )
      if (closed) {
        add('close pane', closed)
        break
      }
      confirms += 1
      await splitActiveTerminalPane(page, 'vertical')
      await waitForBoundPanes(page, 2)
    }

    const tabsBefore = await page.locator(SORTABLE_TAB).count()
    const handles = async (): Promise<RuntimeTerminalListResult['terminals']> =>
      (await read<RuntimeTerminalListResult>(client, 'terminal.list', { worktree })).terminals
    const existing = new Set((await handles()).map((terminal) => terminal.handle))
    add(
      'new tab',
      await timeCommand(page, { kind: 'tabs', count: tabsBefore + 1 }, sender, () =>
        client.call('terminal.create', { worktree })
      )
    )
    const created = (await handles()).find((terminal) => !existing.has(terminal.handle))!
    const title = `latency-${condition}-${index}`
    add(
      'rename',
      await timeCommand(page, { kind: 'tabTitle', title }, sender, () =>
        client.call('terminal.rename', { terminal: created.handle, title })
      )
    )
    const tabs = await read<RuntimeMobileSessionTabsResult>(client, 'session.tabs.list', {
      worktree
    })
    const group = tabs.tabGroups![0]!
    const reversed = group.tabOrder.toReversed()
    add(
      'tab reorder',
      await timeCommand(page, { kind: 'tabOrder', order: reversed.join(',') }, sender, () =>
        client.call('session.tabs.move', {
          worktree,
          tabId: reversed[0],
          targetGroupId: group.id,
          kind: 'reorder',
          tabOrder: reversed
        })
      )
    )
    add(
      'close tab',
      await timeCommand(page, { kind: 'tabs', count: tabsBefore }, sender, () =>
        client.call('terminal.close', { terminal: created.handle })
      )
    )
    await waitForActiveTerminalManager(page)
  }
  return confirms
}

/** The flood condition is only real if every flooding pane is producing output. */
async function expectFlooding(client: RuntimeClient, handle: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const read = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
          terminal: handle,
          limit: 20
        })
        return read.result.terminal.tail.join('\n')
      },
      { timeout: 30_000, message: `flooding terminal ${handle} never produced output` }
    )
    .toContain('orca-latency-flood')
}

/** A worktree of the seeded repo that is never activated, removed by the returned cleanup. */
async function createHiddenWorktree(
  client: RuntimeClient,
  worktreeId: string,
  name: string
): Promise<{ id: string; remove: () => Promise<void> }> {
  const shown = await client.call<{ worktree: { repoId: string } }>('worktree.show', {
    worktree: `id:${worktreeId}`
  })
  const created = await client.call<RuntimeWorktreeCreateResult>('worktree.create', {
    repo: `id:${shown.result.worktree.repoId}`,
    name: `${name}-${Date.now()}`,
    noParent: true,
    activate: false,
    setupDecision: 'skip'
  })
  const id = created.result.worktree.id
  return {
    id,
    remove: async () => {
      await client.call('worktree.rm', { worktree: `id:${id}`, force: true, runHooks: false })
    }
  }
}

type Stats = ReturnType<typeof stats>
type StartupSample = { firstDrawnMs: number; eventLoopDelayMax: number }
type LatencyReport =
  | {
      scenario: 'latency'
      summary: Record<string, { n: number; inAppCommit: Stats; inAppDrawn: Stats; outer: Stats }>
      eventLoopDelay: Record<string, EventLoopDelaySummary>
      closeConfirms: Record<Condition, number>
      samples: Samples
    }
  | {
      scenario: 'first-drawn'
      note: string
      profile: typeof LARGE_PROFILE
      firstDrawn: Stats & { n: number }
      eventLoopDelayMax: Stats
      samples: StartupSample[]
    }

/** All but the samples go to the log on one line, so a CI run's numbers can be read from it. */
function writeLatencyReport(testInfo: TestInfo, { samples, ...summary }: LatencyReport): void {
  const report = { ...summary, platform: process.platform }
  console.log(`[layout-oracle] ${JSON.stringify(report)}`)
  const scenario = summary.scenario
  const dir = process.env[ORACLE_REPORT_DIR_ENV] ?? testInfo.outputPath('layout-oracle')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, `${scenario}-${Date.now()}.json`),
    `${JSON.stringify({ ...report, samples }, null, 2)}\n`
  )
}

// oxlint-disable-next-line no-empty-pattern -- The measurement owns its launch.
test('layout oracle: command to drawn latency', async ({}, testInfo) => {
  test.setTimeout(90 * 60_000)
  const repoPath = seededRepoPathOrSkip()
  const session = createRestartSession(testInfo)
  const { app, page } = await session.launch()
  const cleanups: (() => Promise<void>)[] = []
  try {
    const samples: Samples = {}
    const { worktreeId } = await bootstrapFirstLaunch(page, repoPath)
    const worktree = `id:${worktreeId}`
    const client = new RuntimeClient(session.userDataDir, 30_000)
    await waitForBoundPanes(page, 1)
    const phases: Record<Condition, { from: number; to: number; confirms: number }> = {
      idle: { from: Date.now(), to: 0, confirms: 0 },
      flood: { from: 0, to: 0, confirms: 0 }
    }
    phases.idle.confirms = await measureCondition(page, client, worktreeId, 'idle', samples)
    phases.idle.to = Date.now()

    // Two flooding tabs beside the measured one and one in a worktree that is never shown.
    const list = await read<RuntimeTerminalListResult>(client, 'terminal.list', { worktree })
    const measured = list.terminals[0]!
    const hidden = await createHiddenWorktree(client, worktreeId, 'latency-flood')
    cleanups.push(hidden.remove)
    for (const target of [worktree, worktree, `id:${hidden.id}`]) {
      const flood = await client.call<{ terminal: RuntimeTerminalCreate }>('terminal.create', {
        worktree: target,
        command: FLOOD_COMMAND
      })
      await expectFlooding(client, flood.result.terminal.handle)
    }
    await client.call('terminal.focus', { terminal: measured.handle, navigation: 'host' })
    await waitForActiveTerminalManager(page)
    phases.flood.from = Date.now()
    phases.flood.confirms = await measureCondition(page, client, worktreeId, 'flood', samples)
    phases.flood.to = Date.now()

    const summary = Object.fromEntries(
      Object.entries(samples).map(([action, values]) => [
        action,
        {
          n: values.length,
          inAppCommit: stats(values.map((sample) => sample.inApp.commitMs)),
          inAppDrawn: stats(values.map((sample) => sample.inApp.drawnMs)),
          outer: stats(values.map((sample) => sample.outerMs))
        }
      ])
    )
    const eventLoopDelay = Object.fromEntries(
      Object.entries(phases).map(([condition, phase]) => [
        condition,
        summarizeEventLoopDelay(session.userDataDir, 'main', phase.from, phase.to)
      ])
    )
    const closeConfirms = { idle: phases.idle.confirms, flood: phases.flood.confirms }
    writeLatencyReport(testInfo, {
      scenario: 'latency',
      summary,
      eventLoopDelay,
      closeConfirms,
      samples
    })
  } finally {
    for (const cleanup of cleanups) {
      await cleanup().catch((error: unknown) => console.warn('[layout-oracle] cleanup', error))
    }
    await session.close(app)
    await session.dispose()
  }
})

// oxlint-disable-next-line no-empty-pattern -- The measurement owns its launches.
test('layout oracle: time to first drawn on a large profile', async ({}, testInfo) => {
  test.setTimeout(30 * 60_000)
  const repoPath = seededRepoPathOrSkip()
  const session = createRestartSession(testInfo)
  let { app, page } = await session.launch()
  const cleanups: (() => Promise<void>)[] = []
  try {
    const { worktreeId } = await bootstrapFirstLaunch(page, repoPath)
    const worktree = `id:${worktreeId}`
    const client = new RuntimeClient(session.userDataDir, 30_000)
    for (let index = 0; index < LARGE_PROFILE.hiddenWorktrees; index += 1) {
      const hidden = await createHiddenWorktree(client, worktreeId, `latency-profile-${index}`)
      cleanups.push(hidden.remove)
      for (let tab = 0; tab < LARGE_PROFILE.tabsPerWorktree; tab += 1) {
        await client.call('terminal.create', { worktree: `id:${hidden.id}` })
      }
    }
    for (let tab = 1; tab < LARGE_PROFILE.tabsPerWorktree; tab += 1) {
      await client.call('terminal.create', { worktree })
    }
    const list = await read<RuntimeTerminalListResult>(client, 'terminal.list', { worktree })
    await client.call('terminal.focus', { terminal: list.terminals[0]!.handle, navigation: 'host' })
    await waitForActiveTerminalManager(page)
    for (let panes = 2; panes <= LARGE_PROFILE.activePanes; panes += 1) {
      await splitActiveTerminalPane(page, 'vertical')
      await waitForBoundPanes(page, panes)
    }

    const startup: StartupSample[] = []
    for (let index = 0; index < STARTUP_SAMPLES; index += 1) {
      await session.close(app)
      ;({ app, page } = await session.launch({
        beforeFirstWindow: (next) => installFirstDrawnWatch(next, LARGE_PROFILE.activePanes)
      }))
      const { processStartedAt, drawnAt } = await readFirstDrawn(app, page)
      await waitForEventLoopDelayWindow(session.userDataDir, drawnAt)
      startup.push({
        firstDrawnMs: Math.round(drawnAt - processStartedAt),
        eventLoopDelayMax: summarizeEventLoopDelay(
          session.userDataDir,
          'main',
          processStartedAt,
          drawnAt
        ).max
      })
    }
    writeLatencyReport(testInfo, {
      scenario: 'first-drawn',
      note: 'from main process start, so includes DevTools attach; warm PTY daemon; relative use only',
      profile: LARGE_PROFILE,
      firstDrawn: { n: startup.length, ...stats(startup.map((sample) => sample.firstDrawnMs)) },
      eventLoopDelayMax: stats(startup.map((sample) => sample.eventLoopDelayMax)),
      samples: startup
    })
  } finally {
    for (const cleanup of cleanups) {
      await cleanup().catch((error: unknown) => console.warn('[layout-oracle] cleanup', error))
    }
    await session.close(app)
    await session.dispose()
  }
})
