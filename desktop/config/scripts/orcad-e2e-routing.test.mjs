import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  classifyE2eJobs,
  MANAGED_SSH_E2E_SPEC_PREFIX,
  ORCAD_SERVE_MODE_SWITCH_E2E_SPEC,
  WINDOWS_MISSING_APPDATA_E2E_SPEC
} from './ci-e2e-job-selection.mjs'
import { selectPrE2eSpecs, shouldRunReusablePrE2e } from './pr-e2e-source-routing.mjs'

const root = resolve(import.meta.dirname, '../..')
const jobs = parse(readFileSync(resolve(root, '.github/workflows/e2e.yml'), 'utf8')).jobs
const ORCAD_AUTO_CONVERT_E2E_SPEC = 'tests/e2e/ssh-orcad-auto-convert.spec.ts'
const ORCAD_IDLE_EXIT_E2E_SPEC = 'tests/e2e/ssh-orcad-idle-exit.spec.ts'
const ORCAD_OPEN_IN_OWNER_E2E_SPEC = 'tests/e2e/ssh-orcad-open-in-owner.spec.ts'
const ORCAD_JOURNEY_E2E_SPECS = [
  'tests/e2e/ssh-orcad-terminal-journeys.spec.ts',
  'tests/e2e/ssh-orcad-workspace-tools.spec.ts',
  'tests/e2e/ssh-orcad-vm-provisioned-root.spec.ts'
]

function expectRouted(files, spec) {
  for (const file of files) {
    expect(existsSync(resolve(root, file)), file).toBe(true)
    expect(selectPrE2eSpecs([file]), file).toContain(spec)
    expect(shouldRunReusablePrE2e([file]), file).toBe(true)
  }
}

it('routes the mode-switch spec from its serve sources and harness', () => {
  expectRouted(
    [
      'src/main/orcad/orcad-lifecycle.ts',
      'src/main/daemon/daemon-spawner.ts',
      'tests/e2e/helpers/orca-serve-cli-host.ts',
      'tests/e2e/helpers/headless-paired-runtime-host.ts'
    ],
    ORCAD_SERVE_MODE_SWITCH_E2E_SPEC
  )
})

it('routes the missing-AppData spec from its startup sources and harness', () => {
  expectRouted(
    ['src/main/startup/windows-app-data-path.ts', 'tests/e2e/helpers/orca-serve-cli-host.ts'],
    WINDOWS_MISSING_APPDATA_E2E_SPEC
  )
})

it('routes the auto-convert spec from its conversion sources and harness', () => {
  expectRouted(
    [
      'src/main/ssh/orcad-runtime-conversion.ts',
      'tests/e2e/helpers/orcad-convert-flow.ts',
      'tests/e2e/helpers/orcad-convert-host.ts',
      'tests/e2e/helpers/orcad-template-variant.ts',
      'tests/e2e/helpers/orcad-upgrade-profile.ts'
    ],
    ORCAD_AUTO_CONVERT_E2E_SPEC
  )
  expect(selectPrE2eSpecs(['src/main/ssh/orcad-runtime-conversion.test.ts'])).not.toContain(
    ORCAD_AUTO_CONVERT_E2E_SPEC
  )
})

it('routes the idle-exit spec from its idle sources and the shared convert harness', () => {
  expectRouted(
    [
      'src/shared/orcad-idle-exit.ts',
      'src/main/ssh/orcad-remote-runtime-control.ts',
      'src/main/ssh/orcad-managed-serving.ts',
      'tests/e2e/helpers/orcad-convert-flow.ts',
      'tests/e2e/helpers/orcad-convert-host.ts'
    ],
    ORCAD_IDLE_EXIT_E2E_SPEC,
    ORCAD_OPEN_IN_OWNER_E2E_SPEC
  )
})

it('builds the e2e app when only a build-dependent orcad spec is requested', () => {
  for (const spec of [
    ORCAD_SERVE_MODE_SWITCH_E2E_SPEC,
    ORCAD_AUTO_CONVERT_E2E_SPEC,
    ORCAD_IDLE_EXIT_E2E_SPEC,
    ORCAD_OPEN_IN_OWNER_E2E_SPEC
  ]) {
    expect(classifyE2eJobs(JSON.stringify([spec])), spec).toEqual({
      e2e_run_changed: false,
      e2e_needs_build: true
    })
  }
  expect(jobs['orcad-ssh-docker'].needs).toEqual(['build', 'prepare-native-cache'])
})

it('runs every managed-SSH spec in one sharded lane, only when one is routed', () => {
  const lane = jobs['orcad-ssh-docker']
  expect(lane.if).toBe(
    `inputs.test_files == '' || contains(inputs.test_files, '${MANAGED_SSH_E2E_SPEC_PREFIX}')`
  )
  expect(lane.strategy.matrix.shard).toEqual(['1/2', '2/2'])
  const run = lane.steps.find((step) => step.env?.ORCA_E2E_SSH_DOCKER === '1').run
  expect(run).toContain(` ${MANAGED_SSH_E2E_SPEC_PREFIX} `)
  expect(run).toContain('--shard="$SHARD"')
  for (const spec of [
    ORCAD_AUTO_CONVERT_E2E_SPEC,
    ORCAD_IDLE_EXIT_E2E_SPEC,
    ORCAD_OPEN_IN_OWNER_E2E_SPEC,
    ...ORCAD_JOURNEY_E2E_SPECS
  ]) {
    expect(existsSync(resolve(root, spec)), spec).toBe(true)
    expect(spec.startsWith(MANAGED_SSH_E2E_SPEC_PREFIX), spec).toBe(true)
  }
})

it('runs both Windows serve specs on one runner, each only when requested', () => {
  expect(jobs['windows-missing-appdata-startup']).toBeUndefined()
  const job = jobs['orcad-serve-mode-switch-windows']
  for (const spec of [ORCAD_SERVE_MODE_SWITCH_E2E_SPEC, WINDOWS_MISSING_APPDATA_E2E_SPEC]) {
    expect(job.if, spec).toContain(`contains(inputs.test_files, '${spec}')`)
    const step = job.steps.find((candidate) => candidate.run?.includes(spec))
    expect(step.if, spec).toContain(`contains(inputs.test_files, '${spec}')`)
    expect(step.env.ORCA_STARTUP_DIAGNOSTICS, spec).toBeUndefined()
  }
})

it('routes managed target-owner guards and menus to the real launch regression', () => {
  expectRouted(
    [
      'src/renderer/src/lib/local-path-open-guard.ts',
      'src/renderer/src/lib/external-editor-open-capability.ts',
      'src/renderer/src/lib/worktree-runtime-owner.ts',
      'src/renderer/src/components/sidebar/WorktreeOpenInMenu.tsx',
      'src/renderer/src/components/sidebar/WorktreeContextMenuView.tsx',
      'src/renderer/src/components/right-sidebar/FileExplorer.tsx',
      'src/renderer/src/components/right-sidebar/FileExplorerToolbar.tsx',
      'src/renderer/src/components/right-sidebar/source-control/listing/entry-context-menu.tsx',
      'tests/e2e/helpers/orcad-convert-flow.ts',
      'tests/e2e/helpers/orcad-convert-host.ts',
      'tests/e2e/helpers/orcad-upgrade-profile.ts',
      'tests/e2e/helpers/docker-ssh-host-target.ts'
    ],
    ORCAD_OPEN_IN_OWNER_E2E_SPEC
  )
  expect(selectPrE2eSpecs(['src/renderer/src/lib/local-path-open-guard.test.ts'])).not.toContain(
    ORCAD_OPEN_IN_OWNER_E2E_SPEC
  )
})

it('routes the managed-host journey specs from their harness and sources', () => {
  for (const spec of ORCAD_JOURNEY_E2E_SPECS) {
    expectRouted(
      [
        'tests/e2e/helpers/orcad-managed-workspace.ts',
        'src/renderer/src/components/terminal-pane/terminal-host-workspace-file.ts',
        'src/renderer/src/components/terminal-pane/terminal-host-file-link-existence.ts',
        'src/renderer/src/runtime/runtime-terminal-artifact-read.ts'
      ],
      spec
    )
    expect(classifyE2eJobs(JSON.stringify([spec])), spec).toEqual({
      e2e_run_changed: false,
      e2e_needs_build: true
    })
  }
})
