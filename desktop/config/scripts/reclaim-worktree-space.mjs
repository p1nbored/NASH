#!/usr/bin/env node
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { lock } from 'proper-lockfile'
import { runProcess } from '@orca/process-host'

export async function reclaimWorktreeSpace({
  repoRoot = process.cwd(),
  apply = false,
  automatic = false,
  execute = runProcess,
  acquireLock = lock,
  commonDirectory,
  testsStopped = false,
  releaseCacheMinAgeDays = 30
} = {}) {
  if (apply && !automatic && !testsStopped) {
    throw new Error('Stop cross-version tests, then pass --tests-stopped with --apply')
  }
  if (!Number.isFinite(releaseCacheMinAgeDays) || releaseCacheMinAgeDays < 0) {
    throw new Error('--release-cache-min-age-days requires a non-negative number')
  }
  if (!commonDirectory) {
    const result = await runProcess({
      program: 'git',
      args: ['-C', repoRoot, 'rev-parse', '--git-common-dir']
    })
    if (result.code !== 0 || result.timedOut || !result.stdout.trim()) {
      throw new Error('Run this command inside a local Git repository, or supply --repo')
    }
    commonDirectory = resolve(repoRoot, result.stdout.trim())
  }
  const cacheRoot = join(commonDirectory, 'orca-cache')
  const lockPath = join(cacheRoot, 'storage-cleanup')
  await mkdir(cacheRoot, { recursive: true })
  let release
  try {
    release = await acquireLock(lockPath, { realpath: false, stale: 600_000, retries: 0 })
  } catch (error) {
    if (error.code === 'ELOCKED') {
      throw new Error('Another worktree cleanup is already running')
    }
    throw error
  }
  let cleanupFailed = false
  let cleanupError
  try {
    const scripts = ['reclaim-electron-dists.mjs', 'reclaim-dev-electron-bundles.mjs']
    if (!automatic) {
      scripts.unshift('reclaim-release-test-caches.mjs')
    }
    for (const script of scripts) {
      const args = [resolve(import.meta.dirname, script), '--repo', repoRoot]
      if (apply) {
        args.push('--apply')
      }
      if (script === 'reclaim-release-test-caches.mjs') {
        args.unshift('--import', import.meta.resolve('tsx'))
        args.push('--min-age-days', String(releaseCacheMinAgeDays))
        if (testsStopped) {
          args.push('--tests-stopped')
        }
      }
      const result = await execute({
        program: process.execPath,
        args,
        env: process.env,
        stdio: 'inherit',
        timeoutMs: 10 * 60 * 1000,
        terminationBarrier: true
      })
      if (result.code !== 0 || result.timedOut) {
        throw new Error(`${script} failed; rerun cleanup after resolving the error`)
      }
    }
  } catch (error) {
    cleanupFailed = true
    cleanupError = error
  }
  try {
    await release()
  } catch (error) {
    if (!cleanupFailed) {
      throw error
    }
    console.error(
      `Failed to release cleanup lock: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (cleanupFailed) {
    throw cleanupError
  }
  return { completed: true }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  if (process.argv.includes('--help')) {
    console.log(
      'Usage: pnpm run reclaim:worktree-space [--repo DIRECTORY] [--release-cache-min-age-days 30] [--apply --tests-stopped]'
    )
    console.log(
      'Previews historical test cache cleanup, Electron sharing, and idle dev bundle removal.'
    )
    process.exit(0)
  }
  const repoIndex = process.argv.indexOf('--repo')
  const ageIndex = process.argv.indexOf('--release-cache-min-age-days')
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index]
    if (argument === '--repo' || argument === '--release-cache-min-age-days') {
      index += 1
    } else if (argument !== '--apply' && argument !== '--tests-stopped') {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (
    repoIndex !== -1 &&
    (!process.argv[repoIndex + 1] || process.argv[repoIndex + 1].startsWith('--'))
  ) {
    throw new Error('--repo requires a directory')
  }
  if (
    ageIndex !== -1 &&
    (!process.argv[ageIndex + 1] || process.argv[ageIndex + 1].startsWith('--'))
  ) {
    throw new Error('--release-cache-min-age-days requires a number')
  }
  await reclaimWorktreeSpace({
    repoRoot: repoIndex !== -1 ? resolve(process.argv[repoIndex + 1]) : process.cwd(),
    apply: process.argv.includes('--apply'),
    testsStopped: process.argv.includes('--tests-stopped'),
    releaseCacheMinAgeDays: ageIndex === -1 ? 30 : Number(process.argv[ageIndex + 1])
  }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
