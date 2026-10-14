#!/usr/bin/env node
/**
 * Compile native/windows-security for an orcad Windows slot.
 *
 * orcad runs under its own pinned Node with no node_modules, and its secure-file writes and
 * data-root privacy check need this addon: without it the privacy check fails closed and orcad
 * refuses to start. N-API, so one build serves every Node. Arm64 cross-compiles from x64.
 *
 * Builds in a copy of the sources so the desktop's own build/Release (the host arch) survives.
 *
 *   node config/scripts/build-windows-security-addon.mjs --arch=arm64
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runProcessSync } from '@orca/process-host'
import { ORCAD_WINDOWS_SECURITY_FILENAME } from '../../src/shared/orcad-artifacts.ts'

const { PE_MACHINE, describePeMachine, readPeMachine } = createRequire(import.meta.url)(
  './windows-pe-machine.cjs'
)

const ROOT = resolve(import.meta.dirname, '..', '..')
const SUPPORTED_ARCHES = ['x64', 'arm64']
const PACKAGE_DIR = join(ROOT, 'native', 'windows-security')

export function windowsSecurityAddonOutput(root, arch) {
  return join(root, '.build', 'windows-security', arch, ORCAD_WINDOWS_SECURITY_FILENAME)
}

export function buildWindowsSecurityAddon(arch, output = windowsSecurityAddonOutput(ROOT, arch)) {
  if (!SUPPORTED_ARCHES.includes(arch)) {
    throw new Error(`--arch must be one of ${SUPPORTED_ARCHES.join(', ')}; got ${arch}`)
  }
  if (process.platform !== 'win32') {
    throw new Error(
      `The Windows security addon only builds on Windows; running on ${process.platform}.`
    )
  }
  // Inside the repo so binding.gyp's `require('node-addon-api')` resolves from root node_modules.
  const workDir = join(ROOT, '.build', 'windows-security', arch, 'gyp')
  rmSync(workDir, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  copyFileSync(join(PACKAGE_DIR, 'binding.gyp'), join(workDir, 'binding.gyp'))
  cpSync(join(PACKAGE_DIR, 'src'), join(workDir, 'src'), { recursive: true })
  const result = runProcessSync({
    program: process.execPath,
    args: [
      join(ROOT, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
      'rebuild',
      `--arch=${arch}`
    ],
    cwd: workDir,
    stdio: 'inherit',
    timeoutMs: null
  })
  if (result.code !== 0) {
    throw new Error(`node-gyp failed for ${arch} with exit ${result.code}`)
  }
  const built = join(workDir, 'build', 'Release', 'orca_windows_security.node')
  if (!existsSync(built)) {
    throw new Error(`node-gyp reported success but ${built} is missing.`)
  }
  // Why check the artifact: node-gyp can ignore --arch, and a host could not load the result.
  const machine = readPeMachine(built)
  if (machine !== PE_MACHINE[arch]) {
    throw new Error(`Built binary is ${describePeMachine(machine)}, expected ${arch}.`)
  }
  mkdirSync(resolve(output, '..'), { recursive: true })
  copyFileSync(built, output)
  console.log(`[windows-security] ${arch} -> ${output}`)
  return output
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const arch =
      process.argv.find((arg) => arg.startsWith('--arch='))?.slice('--arch='.length) ?? process.arch
    buildWindowsSecurityAddon(arch)
  } catch (error) {
    console.error(`[windows-security] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
