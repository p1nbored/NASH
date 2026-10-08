import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  chmodSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProcess } from '../../../shared/child-process/run-process'
import { tokenizeCommandLine } from '../../../shared/agent-command-line-entrypoint'
import { getPermissionHookCommand, installPermissionHookScript } from './permission-hook-command'

describe('permission hook executable guards', () => {
  let home: string
  let inputPath: string
  let launcher: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'nash-permission-command-'))
    inputPath = join(home, 'input.json')
    launcher = join(home, 'cli with space!', process.platform === 'win32' ? 'nash.cmd' : 'nash')
    mkdirSync(dirname(launcher), { recursive: true })
  })
  afterEach(() => {
    if (!home.startsWith(join(tmpdir(), 'nash-permission-command-'))) {
      throw new Error('Unexpected fixture directory')
    }
    rmSync(home, { recursive: true, force: true })
  })

  function cli(output: string, exitCode = 0): void {
    const entry = join(home, 'fixture.cjs')
    writeFileSync(
      entry,
      `const fs = require('node:fs'); let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { fs.writeFileSync(${JSON.stringify(inputPath)}, input); process.stdout.write(${JSON.stringify(output)}); process.exitCode = ${exitCode}; });`
    )
    writeFileSync(
      launcher,
      process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "${entry}" %*\r\n`
        : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${entry.replaceAll("'", "'\\''")}' "$@"\n`
    )
    if (process.platform !== 'win32') {
      chmodSync(launcher, 0o755)
    }
  }

  async function invoke(
    options: { installed?: boolean; outside?: boolean; provider?: 'agy' | 'codex' } = {}
  ) {
    const provider = options.provider ?? 'agy'
    if (options.installed !== false) {
      installPermissionHookScript(provider, home)
    }
    const [program, ...args] = tokenizeCommandLine(getPermissionHookCommand(provider, home))
    if (!program) {
      throw new Error('Missing hook program')
    }
    return runProcess({
      program,
      args,
      cwd: home,
      env: {
        ...process.env,
        ORCA_PANE_KEY: options.outside ? '' : 'fixture-pane:1',
        ORCA_CLI_COMMAND: launcher
      },
      input: '{"fixture":"stdin & 日本語 !"}',
      timeoutMs: 10_000,
      windowsVerbatimArguments: process.platform === 'win32' && /cmd\.exe$/i.test(program)
    })
  }

  it('returns AGY ask if its managed script has disappeared', async () => {
    expect((await invoke({ installed: false })).stdout.trim()).toBe('{"decision":"ask"}')
  })
  it('returns AGY ask if its app launcher has disappeared', async () => {
    expect((await invoke()).stdout.trim()).toBe('{"decision":"ask"}')
  })
  it('leaves normal tools alone outside a NASH pane without invoking the CLI', async () => {
    cli('{"decision":"allow"}\n')
    expect((await invoke({ outside: true })).stdout.trim()).toBe('{"decision":"ask"}')
    expect(existsSync(inputPath)).toBe(false)
  })
  it('returns AGY ask if the launcher fails before emitting JSON', async () => {
    cli('', 1)
    expect((await invoke()).stdout.trim()).toBe('{"decision":"ask"}')
  })
  it.each(['allow', 'deny'] as const)(
    'forwards one %s response without appending fallback, even on nonzero exit',
    async (decision) => {
      const output = JSON.stringify({
        decision,
        ...(decision === 'deny' ? { reason: 'No & still no !' } : {})
      })
      cli(`${output}\n`, 1)
      const result = await invoke()
      expect(result.timedOut).toBe(false)
      expect(result.stdout.trim()).toBe(output)
      expect(readFileSync(inputPath, 'utf8')).toBe('{"fixture":"stdin & 日本語 !"}')
    }
  )
  it('keeps the native Codex prompt when its app launcher is unavailable', async () => {
    expect((await invoke({ provider: 'codex' })).stdout).toBe('')
  })

  it('keeps a valid fallback and decision through the existing wrapper for spaced home paths', async () => {
    const original = home
    home = join(home, 'profile with spaces !')
    mkdirSync(home)
    try {
      expect((await invoke({ installed: false })).stdout.trim()).toBe('{"decision":"ask"}')
      cli('{"decision":"deny","reason":"not allowed"}\n')
      expect((await invoke()).stdout.trim()).toBe('{"decision":"deny","reason":"not allowed"}')
    } finally {
      home = original
    }
  })
})
