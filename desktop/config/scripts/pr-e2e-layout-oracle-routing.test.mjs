import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parse } from 'yaml'
import { classifyE2eJobs, selectGeneralE2eSpecs } from './ci-e2e-job-selection.mjs'
import { classifyPrJobs } from './pr-code-change-scope.mjs'
import { isLayoutOracleSource, LAYOUT_ORACLE_E2E_SPECS } from './pr-layout-oracle-route.mjs'
import { selectPrE2eSpecs, shouldRunReusablePrE2e } from './pr-e2e-source-routing.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const prWorkflow = parse(readFileSync(join(projectDir, '.github/workflows/pr.yml'), 'utf8'))

/** One product file per layout writer family; each alone must run the oracle. */
const LAYOUT_AUTHORITIES = [
  'src/shared/workspace-layout/workspace-layout-pane-commands.ts',
  'src/shared/workspace-layout/old-client/index.ts',
  'src/main/persistence/terminal-topology/terminal-topology-commit.ts',
  'src/main/persistence/restoring-sessions/session-owner-fields.ts',
  'src/main/persistence/loading-store/pty-binding-persistence.ts',
  'src/main/remote-layout-snapshot/index.ts',
  'src/main/runtime/orca-runtime-split-pty-backed-terminal.ts',
  'src/main/runtime/orca-runtime-move-headless-mobile-session-tab.ts',
  'src/main/runtime/orca-runtime-create-terminal.ts',
  'src/renderer/src/runtime/mobile-session-tab-close.ts',
  'src/renderer/src/runtime/runtime-layout-client.ts',
  'src/renderer/src/store/slices/tabs.ts',
  'src/renderer/src/store/slices/tabs/tabs-move-actions.ts',
  'tests/e2e/workspace-layout-oracle-known-on-main.ts',
  'tests/e2e/helpers/workspace-layout-oracle-compare.ts',
  ...LAYOUT_ORACLE_E2E_SPECS
]

/** Widened while the layout-holder stack is open: these still write layout. */
const STACK_WRITERS = [
  'src/renderer/src/store/slices/terminals.ts',
  'src/renderer/src/components/terminal-pane/TerminalPane.tsx',
  'src/renderer/src/runtime/sync-runtime-graph.ts',
  'src/renderer/src/runtime/web-session-tabs-sync/store-patch.ts',
  'src/main/runtime/orca-runtime-split-terminal.ts',
  'src/main/runtime/orca-runtime-sync-window-graph.ts',
  'src/main/runtime/mobile-session-layout-projection.ts',
  'src/main/runtime/headless-runtime-graph.ts',
  'src/main/persistence/loading-store/session-host-partitions.ts',
  'src/main/persistence/loading-store/workspace-session-snapshot-publication.ts',
  'src/renderer/src/store/slices/tab-group-reference-repair.ts',
  'src/renderer/src/store/slices/terminal-session-row-hydration.ts',
  'src/renderer/src/store/workspace-layout-cache.ts',
  'src/renderer/src/app-shell/use-runtime-graph-sync.ts',
  'src/renderer/src/components/tab-group/tab-drag-drop-commit.ts',
  'src/shared/remote-layout-snapshot.ts',
  'src/shared/terminal-leaf-move.ts',
  'src/main/ipc/pty/ipc/leaf-move.ts',
  'src/main/persistence/closed-terminal-tab-write-fence.ts',
  'src/main/runtime/runtime-workspace-session-controller.ts',
  'src/main/runtime/terminal-surface-close.ts',
  'src/renderer/src/components/terminal/terminal-tab-actions.ts',
  'src/renderer/src/components/tab-bar/web-runtime-tab-move-mirror.ts',
  'src/shared/rpc-contract/workspace-layout-params.ts',
  'src/renderer/src/store/slices/recently-closed-tabs.ts'
]

/** Every test file the oracle specs import, transitively: a change there can break the gate. */
function oracleHarnessFiles() {
  const seen = new Set()
  const pending = [...LAYOUT_ORACLE_E2E_SPECS]
  while (pending.length > 0) {
    const file = pending.pop()
    if (seen.has(file)) {
      continue
    }
    seen.add(file)
    const source = readFileSync(join(projectDir, file), 'utf8')
    for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) {
      const base = relative(projectDir, join(projectDir, dirname(file), specifier))
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find(
        (candidate) => /\.tsx?$/.test(candidate) && existsSync(join(projectDir, candidate))
      )
      if (resolved?.startsWith('tests/')) {
        pending.push(resolved)
      }
    }
  }
  return [...seen]
}

describe('workspace layout oracle merge gate', () => {
  it('routes each layout authority and stack writer on its own', () => {
    for (const file of [...LAYOUT_AUTHORITIES, ...STACK_WRITERS]) {
      expect(isLayoutOracleSource(file), file).toBe(true)
      expect(classifyPrJobs([file]).layout_oracle, file).toBe(true)
      expect(existsSync(join(projectDir, file)), file).toBe(true)
    }
  })

  it('routes every test file the oracle specs import', () => {
    const harness = oracleHarnessFiles()
    expect(harness.length).toBeGreaterThan(LAYOUT_ORACLE_E2E_SPECS.length)
    expect(harness.filter((file) => !isLayoutOracleSource(file))).toEqual([])
  })

  it('leaves tests, fixtures, harnesses and unrelated runtime modules alone', () => {
    for (const file of [
      'src/main/persistence/terminal-topology/terminal-topology-commit.test.ts',
      'src/main/persistence/terminal-topology/terminal-leaf-move-fixture.ts',
      'src/main/runtime/orca-runtime-tests/mobile-session-tabs-part-03.spec.ts',
      'src/main/runtime/runtime-durable-store-fixture.ts',
      'src/main/runtime/orchestration/db/worker-terminal/worker-terminal-store.ts',
      'src/main/runtime/rpc/methods/terminal/terminal-create.ts',
      'src/main/runtime/runtime-rpc-database.ts',
      'src/main/runtime/orca-runtime-files.ts',
      'src/renderer/src/runtime/remote-runtime-terminal-multiplexer.ts',
      'src/renderer/src/runtime/web-session-tabs-sync-test-harness.ts',
      'src/renderer/src/runtime/sync-runtime-graph-test-harness.ts',
      'src/renderer/src/runtime/sync-runtime-graph.test.ts',
      'tests/e2e/workspace-layout-oracle-latency.spec.ts'
    ]) {
      expect(isLayoutOracleSource(file), file).toBe(false)
    }
    expect(classifyPrJobs(['src/main/runtime/orca-runtime-files.ts']).layout_oracle).toBe(false)
  })

  it('keeps the oracle specs out of the advisory e2e job', () => {
    expect(selectPrE2eSpecs(LAYOUT_AUTHORITIES)).toEqual([])
    expect(shouldRunReusablePrE2e(LAYOUT_AUTHORITIES)).toBe(false)
  })

  it('runs exactly the oracle specs, each in the lane that can run it', () => {
    const job = prWorkflow.jobs.layout_oracle
    expect(job.uses).toBe('./.github/workflows/e2e.yml')
    // The merge commit, so a stale-base PR cannot pass on an old main.
    expect(job.with.ref).toBe('${{ github.sha }}')
    const specs = JSON.parse(job.with.test_files)
    expect(specs.toSorted()).toEqual(LAYOUT_ORACLE_E2E_SPECS.toSorted())
    // Window spec runs in the changed-spec lane; headless runs in the orcad lane.
    expect(selectGeneralE2eSpecs(specs)).toEqual(['tests/e2e/workspace-layout-oracle.spec.ts'])
    expect(classifyE2eJobs(job.with.test_files)).toEqual({
      e2e_run_changed: true,
      e2e_needs_build: true
    })
  })

  it('blocks the merge on the oracle and passes when it is skipped', () => {
    const verify = prWorkflow.jobs.verify
    const gate = verify.steps.find((step) => step.name === 'Require successful checks')
    expect(verify.needs).toContain('layout_oracle')
    expect(gate.run).toContain(
      'check_job layout_oracle "$LAYOUT_ORACLE" "$LAYOUT_ORACLE_SHOULD_RUN"'
    )
    // Two calls of the reusable workflow in one run must not share artifact names.
    expect(prWorkflow.jobs.layout_oracle.with.artifact_suffix).toBeTruthy()
    expect(prWorkflow.jobs.e2e.with.artifact_suffix).toBeUndefined()
  })
})
