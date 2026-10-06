// FIXTURE_ONLY stand-in for the agy CLI. It never contacts a model, the network or any
// credential: it plays back a scripted stdout so the runner can be tested without the real
// binary (which is paid and not authorized in tests).
//
// Contract with the test helper: the scenario is read from `fake-scenario.json` in the working
// directory (the runner's env is an allowlist, and the run directory is created by the runner
// itself, so neither can carry it). Observations go to `fake-received.json` in the run
// directory, which is the parent of the run-local TEMP/TMPDIR the runner sets.
//
// Step shapes: { stdout } | { stdoutParts, gapMs } | { stderr } | { bigStdout } | { delayMs } |
//   { hang } | { grandchild } | { ready } | { exit }
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)

if (args[0] === '--version') {
  process.stdout.write('1.2.14-fixture\n')
  process.exit(0)
}

const tempDir = process.env.TEMP ?? process.env.TMPDIR
if (!tempDir) {
  process.stderr.write('fake-agy: no run-local temp directory\n')
  process.exit(96)
}
const runDir = dirname(tempDir)
let scenario
try {
  scenario = JSON.parse(readFileSync(join(process.cwd(), 'fake-scenario.json'), 'utf8'))
} catch {
  process.stderr.write('fake-agy: scenario missing\n')
  process.exit(97)
}

const SAFE_ENV_VALUES = ['TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE']
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const write = (stream, text) => new Promise((resolve) => stream.write(text, resolve))

const readStdin = () =>
  new Promise((resolve) => {
    const chunks = []
    process.stdin.on('data', (chunk) => chunks.push(chunk))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)))
    process.stdin.on('error', () => resolve(Buffer.concat(chunks)))
  })

const stdin = await readStdin()
writeFileSync(
  join(runDir, 'fake-received.json'),
  JSON.stringify({
    argv: args,
    pid: process.pid,
    cwd: process.cwd(),
    stdinBytes: stdin.length,
    envNames: Object.keys(process.env).sort(),
    envValues: Object.fromEntries(
      SAFE_ENV_VALUES.filter((name) => process.env[name] !== undefined).map((name) => [
        name,
        process.env[name]
      ])
    )
  })
)

for (const step of scenario.steps) {
  if ('stdout' in step) {
    await write(process.stdout, step.stdout)
  } else if ('stdoutParts' in step) {
    for (const part of step.stdoutParts) {
      await write(process.stdout, part)
      await sleep(step.gapMs ?? 10)
    }
  } else if ('stderr' in step) {
    await write(process.stderr, step.stderr)
  } else if ('bigStdout' in step) {
    // Writes in chunks until the byte count is reached, or the reader stops (a killed run ends the loop).
    const chunk = 'x'.repeat(64 * 1024)
    for (let sent = 0; sent < step.bigStdout; sent += chunk.length) {
      await write(process.stdout, chunk)
    }
  } else if ('delayMs' in step) {
    await sleep(step.delayMs)
  } else if ('grandchild' in step) {
    // A descendant the runner must also stop when it tears the tree down.
    const child = spawn(
      process.execPath,
      ['-e', `setTimeout(() => process.exit(0), ${step.lifetimeMs ?? 60000})`],
      // With inheritStdout the helper holds the pipes open, as a leaked helper would.
      { stdio: step.inheritStdout ? ['ignore', 'inherit', 'inherit'] : 'ignore' }
    )
    // Unref so the root can exit while the descendant lives on, as a leaked helper would.
    child.unref()
    writeFileSync(join(runDir, 'fake-grandchild.pid'), String(child.pid))
  } else if ('ready' in step) {
    // Signals the test that everything scripted before this point has happened.
    writeFileSync(join(runDir, 'fake-ready'), 'ready')
  } else if ('hang' in step) {
    setInterval(() => {}, 1_000_000)
    await new Promise(() => {})
  } else if ('exit' in step) {
    process.exitCode = step.exit
  }
}
