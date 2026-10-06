// FIXTURE_ONLY stand-in for the Codex CLI. It never contacts a model, the network
// or any credential: it plays back a scripted JSONL stream so the runner can be
// tested without the real binary (which is paid and not authorized in tests).
//
// Contract with the test helper: the scenario is read from `fake-scenario.json` in the working
// directory (the runner's env is an allowlist, and the run directory is created by the runner
// itself, so neither can carry it). Observations go to `fake-received.json` beside the
// `--output-last-message` path.
//
// Step shapes: { event } | { stdout } | { stdoutParts, gapMs } | { stderr } | { lastMessage } |
//   { bigLine } | { delayMs } | { hang } | { grandchild } | { ready } | { exit }
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const args = process.argv.slice(2)

if (args[0] === '--version') {
  process.stdout.write('codex-cli 0.0.0-fixture\n')
  process.exit(0)
}

const flagValue = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const lastMessagePath = flagValue('--output-last-message')
if (!lastMessagePath) {
  process.stderr.write('fake-codex: --output-last-message is required\n')
  process.exit(96)
}
const runDir = dirname(lastMessagePath)
let scenario
try {
  scenario = JSON.parse(readFileSync(join(process.cwd(), 'fake-scenario.json'), 'utf8'))
} catch {
  process.stderr.write('fake-codex: scenario missing\n')
  process.exit(97)
}

const SAFE_ENV_VALUES = ['TEMP', 'TMP', 'TMPDIR', 'CODEX_HOME', 'HOME', 'USERPROFILE']
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
    cwd: process.cwd(),
    stdinBase64: stdin.toString('base64'),
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
  if ('event' in step) {
    await write(process.stdout, `${JSON.stringify(step.event)}\n`)
  } else if ('stdout' in step) {
    await write(process.stdout, step.stdout)
  } else if ('stdoutParts' in step) {
    for (const part of step.stdoutParts) {
      await write(process.stdout, part)
      await sleep(step.gapMs ?? 10)
    }
  } else if ('stderr' in step) {
    await write(process.stderr, step.stderr)
  } else if ('lastMessage' in step) {
    writeFileSync(lastMessagePath, step.lastMessage, 'utf8')
  } else if ('bigLine' in step) {
    const pad = 'x'.repeat(step.bigLine)
    await write(
      process.stdout,
      `${JSON.stringify({ type: step.bigLineType ?? 'item.completed', item: { id: 'big', type: 'command_execution', aggregated_output: pad } })}\n`
    )
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
