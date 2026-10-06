/**
 * The script a NASH primary session's `statusLine` runs (user decision of 2026-10-06, "Primary
 * only"). Claude Code starts it through its shell on each status-line render, with the app binary
 * as Node (`ELECTRON_RUN_AS_NODE=1`): it forwards `rate_limits` to NASH's hook listener and prints
 * the user's own status line. It always exits 0 and never writes anything but that output.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { forwardClaudeRateLimits } from './relay-forward'
import { postToHookServer } from './relay-http-post'
import { runClaudeStatusLineRelay } from './relay-run'
import { runUserStatusLine } from './relay-user-command'

/** Past the user command's bound plus Orca's exit grace, the relay leaves with nothing printed. */
const HARD_DEADLINE_MS = 8_000
/** The throttle stamp and the endpoint file are a few dozen bytes. */
const SMALL_FILE_MAX_BYTES = 64 * 1024

function readSmallText(path: string): string | null {
  try {
    return statSync(path).size > SMALL_FILE_MAX_BYTES ? null : readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function writeSmallText(path: string, text: string): void {
  try {
    writeFileSync(path, text)
  } catch {
    // Best effort: a missing stamp only lets the next render post again.
  }
}

function readStdin(maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    process.stdin.on('data', (chunk: Buffer) => {
      size += chunk.length
      // Why keep draining past the cap: the writer must not see a broken pipe.
      if (size <= maxBytes) {
        chunks.push(chunk)
      }
    })
    process.stdin.on('end', () =>
      resolve(size > maxBytes ? null : Buffer.concat(chunks).toString('utf8'))
    )
    process.stdin.on('error', () => resolve(null))
  })
}

const deadline = setTimeout(() => process.exit(0), HARD_DEADLINE_MS)
deadline.unref()
// Why: Claude Code may close the pipe of a render it no longer needs; that is not a failure.
process.stdout.on('error', () => process.exit(0))

void runClaudeStatusLineRelay({
  argv: process.argv.slice(2),
  readStdin,
  writeStdout: (bytes) => {
    process.stdout.write(bytes)
  },
  forward: (payload) =>
    forwardClaudeRateLimits(payload, {
      env: process.env,
      tempDir: tmpdir(),
      nowSeconds: () => Math.floor(Date.now() / 1000),
      readText: readSmallText,
      writeText: writeSmallText,
      post: (request) => postToHookServer(request)
    }),
  runUser: (request, input) =>
    runUserStatusLine(request, input, { env: process.env, cwd: process.cwd() })
}).finally(() => {
  // Why exit explicitly: a lingering handle must not keep Claude Code waiting for the status line.
  process.stdout.write('', () => process.exit(0))
})
