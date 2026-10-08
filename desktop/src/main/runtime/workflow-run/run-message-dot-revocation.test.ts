import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createDotHarness,
  FIXTURE_BINDING,
  type DotHarness
} from '../dot-ingress/dot-ingress-service.test-fixture'
import { seedRunWithRunningOwner } from '../orchestration/db/autopilot-runtime.test-fixture'
import { getDotIngressStore } from '../orchestration/db/dot-ingress-store'
import { getDotIngressSettingsStore } from '../orchestration/db/dot-ingress-settings-store'
import { ensureDotCoordinatorAttachments } from '../orchestration/db/dot-coordinator-attachment'
import { getRunMessageStore } from '../orchestration/db/run-message-store'
import { insertHeldRunMessageInTransaction } from '../orchestration/db/run-message-insert'
import { createRunMessageDelivery, type RunMessageDelivery } from './run-message-delivery'
import { runMessageTextSha256 } from './run-message-text-checks'
import { createFakeTerminal } from './primary-session.test-fixture'
import { manualTimers } from './run-message.test-fixture'

const RUN = 'run_fixture01'
const TEXT = 'Please review the existing work.'

describe('Dot message authority at delivery', () => {
  let h: DotHarness
  let delivery: RunMessageDelivery
  let fake: ReturnType<typeof createFakeTerminal>
  let timers: ReturnType<typeof manualTimers>
  let dotRequestId: string
  beforeEach(() => {
    h = createDotHarness({ maxAccess: 'workspace_write' })
    seedRunWithRunningOwner(h.owner)
    h.owner.db
      .prepare("UPDATE workflow_runs SET status = 'active', workspace_binding = ?")
      .run(FIXTURE_BINDING)
    const input = h.submitRequest({ requestedAccess: 'workspace_write' })
    const store = getDotIngressStore(h.owner)
    dotRequestId = store.submit({
      workspaceRef: input.workspaceRef,
      workspaceBinding: FIXTURE_BINDING,
      objective: input.objective,
      requestedAccess: input.requestedAccess,
      idempotencyKey: input.idempotencyKey,
      replyCorrelationId: null,
      client: null,
      scanRules: [],
      timestamp: h.deps.now().toISOString()
    }).record.dotRequestId
    store.linkSubmitted({
      dotRequestId,
      workbenchRequestId: 'request_fixture01',
      timestamp: h.deps.now().toISOString()
    })
    fake = createFakeTerminal({
      incarnations: new Map([['terminal_fixture01', 'incarnation_fixture01']]),
      panes: new Map([['pane_fixture01:1', 'terminal_fixture01']])
    })
    timers = manualTimers()
    delivery = createRunMessageDelivery({
      db: h.owner,
      terminal: fake.terminal,
      clock: { now: () => h.deps.now().getTime() },
      newRequestId: () => 'send_fixture',
      timers: timers.timers
    })
  })
  afterEach(() => {
    delivery.dispose()
    h.close()
  })
  const send = (sourceRequestId = 'message_fixture') =>
    delivery.deliver({ runId: RUN, source: 'dot', sourceRequestId, text: TEXT })

  function attach(): void {
    ensureDotCoordinatorAttachments(h.owner.db)
    h.owner.db
      .prepare('INSERT INTO dot_coordinator_attachments VALUES (?, ?, ?)')
      .run(RUN, dotRequestId, h.deps.now().toISOString())
  }

  it('delivers while the current Dot workspace grant remains enabled', async () => {
    await expect(send()).resolves.toMatchObject({ outcome: 'delivered' })
    expect(fake.terminal.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
  })

  it.each([false, true])(
    'refuses a held message after disabling its workspace (attached=%s)',
    async (attached) => {
      if (attached) {
        attach()
      }
      fake.state.status = 'permission'
      await expect(send()).resolves.toMatchObject({ state: 'held' })
      getDotIngressSettingsStore(h.owner).disableWorkspace({
        workspaceRef: h.workspaceRef,
        timestamp: h.deps.now().toISOString()
      })
      fake.state.status = 'idle'
      await delivery.flushHeld(RUN)
      expect(getRunMessageStore(h.owner).findBySource('dot', 'message_fixture')).toMatchObject({
        state: 'refused',
        reason: 'run_not_owned_by_source'
      })
      expect(fake.terminal.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    }
  )

  it('refuses held messages after disabling Dot or lowering the workspace access ceiling', async () => {
    fake.state.status = 'permission'
    await send()
    h.owner.db.prepare("UPDATE dot_ingress_workspace_access SET max_access = 'read_only'").run()
    fake.state.status = 'idle'
    await delivery.flushHeld(RUN)
    expect(fake.terminal.sendTerminalAgentPrompt).not.toHaveBeenCalled()
    getDotIngressSettingsStore(h.owner).setEnabled({
      enabled: false,
      timestamp: h.deps.now().toISOString()
    })
    await expect(send('after_disabled')).resolves.toMatchObject({ outcome: 'refused' })
  })

  it('rechecks before paste when access is revoked during the terminal status read', async () => {
    fake.terminal.getTerminalAgentStatus.mockImplementationOnce(async (handle) => {
      getDotIngressSettingsStore(h.owner).setEnabled({
        enabled: false,
        timestamp: h.deps.now().toISOString()
      })
      return { handle, isRunningAgent: true, status: 'idle' }
    })
    await expect(send()).resolves.toMatchObject({
      state: 'refused',
      reason: 'run_not_owned_by_source'
    })
  })

  it('does not press Enter after access is revoked between paste and submit', async () => {
    let entered = false
    fake.terminal.sendTerminalAgentPrompt.mockImplementationOnce(async (handle, _text, options) => {
      await options.beforeWrite?.('pty_fixture')
      getDotIngressSettingsStore(h.owner).setEnabled({
        enabled: false,
        timestamp: h.deps.now().toISOString()
      })
      await options.beforeWrite?.('pty_fixture')
      entered = true
      return { handle, accepted: true, bytesWritten: TEXT.length }
    })
    await expect(send()).resolves.toMatchObject({ state: 'refused', reason: 'delivery_incomplete' })
    expect(entered).toBe(false)
  })

  function holdInTransaction() {
    return insertHeldRunMessageInTransaction(h.owner.db, {
      runId: RUN,
      source: 'dot',
      sourceRequestId: 'message_fixture',
      text: TEXT,
      textSha256: runMessageTextSha256(TEXT),
      reason: 'coordinator_attached',
      timestamp: h.deps.now().toISOString()
    })
  }

  it('commits a durable initial message with its caller transaction and kicks it on replay', async () => {
    h.owner.db.exec('BEGIN')
    holdInTransaction()
    h.owner.db.exec('COMMIT')
    await expect(send()).resolves.toMatchObject({ duplicate: true, state: 'delivered' })
    expect(fake.terminal.sendTerminalAgentPrompt).toHaveBeenCalledOnce()
  })

  it('rolls back a transactional held message and refuses insertion outside a transaction', () => {
    expect(holdInTransaction).toThrow()
    h.owner.db.exec('BEGIN')
    holdInTransaction()
    h.owner.db.exec('ROLLBACK')
    expect(getRunMessageStore(h.owner).findBySource('dot', 'message_fixture')).toBeNull()
  })

  it('rearms persisted held messages after restart without a client replay', async () => {
    h.owner.db.exec('BEGIN')
    holdInTransaction()
    h.owner.db.exec('COMMIT')
    expect(delivery.settleInterrupted()).toBe(0)
    expect(timers.pendingCount()).toBe(1)
    timers.fireAll()
    await delivery.drain(RUN)
    expect(getRunMessageStore(h.owner).findBySource('dot', 'message_fixture')?.state).toBe(
      'delivered'
    )
  })
})
