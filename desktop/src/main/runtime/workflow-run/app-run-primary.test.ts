import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration/db/orchestration-db'
import { resolveAppRunPrimary } from './app-run-primary'
import {
  markRunAsAppRun,
  OTHER_PANE_KEY,
  PRIMARY_PANE_KEY,
  PRIMARY_PANE_KEY_REMINTED,
  type AppRunSeed
} from './app-run-policy.test-fixture'
import { appRunReadersFor } from './app-run-readers'

// FIXTURE_ONLY: run ids, panes and incarnations are synthetic.
const RUN = 'run_fixture_a'
const OTHER_RUN = 'run_fixture_b'
const authority = (overrides: { paneKey?: string; processIncarnation?: string } = {}) => ({
  paneKey: PRIMARY_PANE_KEY,
  processIncarnation: `incarnation_${RUN}`,
  ...overrides
})

describe('resolveAppRunPrimary', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })
  afterEach(() => db.close())

  function seed(overrides: Partial<AppRunSeed> = {}): void {
    markRunAsAppRun(db, { runId: RUN, ...overrides })
  }

  function resolve(
    caller = authority(),
    scope: { runId?: string; openRunOnly?: boolean } = {}
  ): ReturnType<typeof resolveAppRunPrimary> {
    return resolveAppRunPrimary(db, appRunReadersFor(db), caller, scope)
  }

  it('finds the run and owner of the live primary from its attested pane', () => {
    seed()
    const resolved = resolve()
    expect(resolved).toMatchObject({ ok: true, primary: { run: { runId: RUN, status: 'active' } } })
    expect(resolved.ok && resolved.primary.ownerId).toMatch(/\S/)
  })

  it('accepts the pane after Orca reminted its tab half, as the pane-key match does elsewhere', () => {
    seed()
    expect(resolve(authority({ paneKey: PRIMARY_PANE_KEY_REMINTED })).ok).toBe(true)
  })

  it('checks the pane against the run Orca binds it to when a run is named', () => {
    seed()
    expect(resolve(authority(), { runId: RUN }).ok).toBe(true)
    expect(resolve(authority(), { runId: OTHER_RUN })).toEqual({
      ok: false,
      refusal: 'not_app_run'
    })
  })

  it('refuses a pane that is not the live primary of any app run', () => {
    seed()
    expect(resolve(authority({ paneKey: OTHER_PANE_KEY }))).toEqual({
      ok: false,
      refusal: 'not_run_primary'
    })
    expect(resolve(authority({ paneKey: OTHER_PANE_KEY }), { runId: RUN })).toEqual({
      ok: false,
      refusal: 'not_run_primary'
    })
  })

  it('refuses a run whose primary is still starting or has exited', () => {
    seed({ primary: 'exited' })
    expect(resolve()).toEqual({ ok: false, refusal: 'not_run_primary' })
  })

  it('refuses another process in the primary pane', () => {
    seed()
    expect(resolve(authority({ processIncarnation: 'incarnation_other' }))).toEqual({
      ok: false,
      refusal: 'process_mismatch'
    })
  })

  it('refuses a closed run only when the caller asks for an open one', () => {
    seed({ status: 'completed' })
    expect(resolve()).toMatchObject({ ok: true, primary: { run: { status: 'completed' } } })
    expect(resolve(authority(), { openRunOnly: true })).toEqual({
      ok: false,
      refusal: 'run_closed'
    })
  })
})
