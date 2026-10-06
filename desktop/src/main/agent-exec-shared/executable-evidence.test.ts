import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collectExecutableEvidence } from './executable-evidence'
import type { LaunchTarget } from './launch-target'

let root = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-exec-evidence-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A script launched through the current node, the shape the runners use for their fakes. */
function nodeEntryTarget(entryPath: string): LaunchTarget {
  return {
    program: process.execPath,
    prefixArgs: [entryPath],
    entryPath,
    requestedPath: entryPath,
    launch: 'node-entry'
  }
}

function scriptExecutable(name: string, source: string) {
  const entryPath = join(root, name)
  writeFileSync(entryPath, source)
  return nodeEntryTarget(entryPath)
}

describe('collectExecutableEvidence', () => {
  it('records the launch path and the --version output, and never hashes the binary (D-023)', async () => {
    const executable = scriptExecutable(
      'version-fixture.mjs',
      'process.stdout.write("codex-cli 0.0.0-fixture\\n")'
    )
    const evidence = await collectExecutableEvidence(executable, { env: process.env })
    expect(evidence).toEqual({
      path: executable.entryPath,
      program: process.execPath,
      prefixArgs: [executable.entryPath],
      entryPath: executable.entryPath,
      version: '0.0.0-fixture',
      versionText: 'codex-cli 0.0.0-fixture',
      versionProbe: 'ok'
    })
  })

  it('reports a failing version probe as failed with a null version', async () => {
    const executable = scriptExecutable(
      'exit-three.mjs',
      'process.stderr.write("nope"); process.exit(3)'
    )
    const evidence = await collectExecutableEvidence(executable, { env: process.env })
    expect(evidence).toMatchObject({ version: null, versionText: null, versionProbe: 'failed' })
  })

  it('reports a probe that prints no version as failed', async () => {
    const executable = scriptExecutable('no-version.mjs', 'process.stdout.write("hello\\n")')
    const evidence = await collectExecutableEvidence(executable, { env: process.env })
    expect(evidence).toMatchObject({ version: null, versionProbe: 'failed' })
    expect(evidence.versionText).toBe('hello')
  })

  it('bounds a hanging probe and reports timed_out', async () => {
    const executable = scriptExecutable('hang.mjs', 'setInterval(() => {}, 1000)')
    const started = Date.now()
    const evidence = await collectExecutableEvidence(executable, {
      env: process.env,
      timeoutMs: 300
    })
    expect(evidence).toMatchObject({ version: null, versionProbe: 'timed_out' })
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('reports a failed probe for a launch file that is gone', async () => {
    const executable = scriptExecutable(
      'vanishing.mjs',
      'process.stdout.write("codex-cli 9.9.9\\n")'
    )
    rmSync(executable.entryPath)
    const evidence = await collectExecutableEvidence(executable, { env: process.env })
    expect(evidence).not.toHaveProperty('sha256')
    expect(evidence.versionProbe).toBe('failed')
  })

  it('probes with exactly the environment it is given', async () => {
    const executable = scriptExecutable(
      'env-probe.mjs',
      'process.stdout.write(`codex-cli 1.2.3 ${process.env.PROBE_MARKER ?? "absent"}\\n`)'
    )
    const withMarker = await collectExecutableEvidence(executable, {
      env: { ...process.env, PROBE_MARKER: 'present' }
    })
    expect(withMarker.versionText).toBe('codex-cli 1.2.3 present')
    const without = await collectExecutableEvidence(executable, {
      env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH }
    })
    expect(without.versionText).toBe('codex-cli 1.2.3 absent')
    expect(without.version).toBe('1.2.3')
  })
})
