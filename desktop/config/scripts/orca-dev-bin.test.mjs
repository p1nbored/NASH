import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = path.resolve(import.meta.dirname, '../..')
const packageJson = JSON.parse(readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
const wrapperPath = path.join(projectDir, 'config', 'scripts', 'orca-dev.mjs')

const identity = JSON.parse(
  readFileSync(path.join(projectDir, 'src', 'shared', 'app-identity-constants.json'), 'utf8')
)

describe('nash-dev package bin', () => {
  it('publishes the NASH package name and global commands, never the Orca ones', () => {
    expect(packageJson.name).toBe(identity.cliCommandName)
    expect(packageJson.bin[identity.cliCommandName]).toBe('./out/cli/index.js')
    expect(Object.keys(packageJson.bin).sort()).toEqual(
      [identity.cliCommandName, identity.devCliCommandName].sort()
    )
  })

  it('uses a Node entrypoint for cross-platform package installs', () => {
    expect(packageJson.bin[identity.devCliCommandName]).toBe('./config/scripts/orca-dev.mjs')
    expect(readFileSync(wrapperPath, 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/)
  })

  it('keeps the Bash wrapper and the dev installer on the NASH dev profile and command', () => {
    const bashWrapper = readFileSync(path.join(projectDir, 'config', 'scripts', 'orca-dev'), 'utf8')
    expect(bashWrapper).toContain(`/${identity.devUserDataDirName}"`)
    expect(bashWrapper).not.toContain('/orca-dev"')
    const installer = readFileSync(
      path.join(projectDir, 'config', 'scripts', 'install-dev-cli.mjs'),
      'utf8'
    )
    // Why: the installer reads the command name from the shared identity JSON instead of spelling it out.
    expect(installer).toContain('/usr/local/bin/${devCliCommandName}')
    expect(installer).toContain('app-identity-constants.json')
    expect(installer).not.toContain('/usr/local/bin/orca-dev')
  })

  it('runs the dev CLI through Node without requiring Bash', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'orca-dev-bin-'))
    const cliEntry = path.join(root, 'cli-entry.cjs')
    const outputPath = path.join(root, 'output.json')
    writeFileSync(
      cliEntry,
      [
        'const fs = require("node:fs");',
        `fs.writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify({`,
        '  argv: process.argv.slice(2),',
        '  userDataPath: process.env.ORCA_USER_DATA_PATH,',
        '  devCliInvocation: process.env.ORCA_DEV_CLI_INVOCATION,',
        '  appExecutable: process.env.ORCA_APP_EXECUTABLE',
        '}));'
      ].join('\n'),
      'utf8'
    )
    if (process.platform !== 'win32') {
      chmodSync(cliEntry, 0o755)
    }

    execFileSync(process.execPath, [wrapperPath, '--help'], {
      env: {
        ...process.env,
        ORCA_DEV_CLI_ENTRY_PATH: cliEntry,
        ORCA_DEV_USER_DATA_PATH: path.join(root, 'user-data'),
        ORCA_APP_EXECUTABLE: path.join(root, 'Electron')
      },
      stdio: 'ignore'
    })

    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual({
      argv: ['--help'],
      userDataPath: path.join(root, 'user-data'),
      devCliInvocation: '1',
      appExecutable: path.join(root, 'Electron')
    })
  })
})
