import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAutopilotInput } from './autopilot-cli-input'

async function* chunks(...parts: string[]): AsyncIterable<Uint8Array | string> {
  for (const part of parts) {
    yield Buffer.from(part, 'utf8')
  }
}

describe('readAutopilotInput', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('reads stdin for `-`', async () => {
    const text = await readAutopilotInput('-', 'summary', {
      cwd: '/unused',
      stdin: chunks('Done', '.\n'),
      stdinIsTty: false
    })
    expect(text).toBe('Done.\n')
  })

  it('refuses `-` from an interactive terminal instead of waiting forever', async () => {
    await expect(
      readAutopilotInput('-', 'spec', { cwd: '/unused', stdin: chunks(), stdinIsTty: true })
    ).rejects.toMatchObject({ code: 'invalid_argument', message: expect.stringMatching(/stdin/) })
  })

  it('reads a file relative to the working directory', async () => {
    dir = mkdtempSync(join(tmpdir(), 'autopilot-cli-input-'))
    writeFileSync(join(dir, 'spec.json'), '{"objective":"x"}')
    const text = await readAutopilotInput('spec.json', 'spec', {
      cwd: dir,
      stdin: chunks(),
      stdinIsTty: false
    })
    expect(text).toBe('{"objective":"x"}')
  })

  it('refuses a missing file in English without echoing its content', async () => {
    dir = mkdtempSync(join(tmpdir(), 'autopilot-cli-input-'))
    await expect(
      readAutopilotInput('missing.json', 'spec', { cwd: dir, stdin: chunks(), stdinIsTty: false })
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: 'Cannot read the TaskSpec file `missing.json`.'
    })
  })

  it('refuses input larger than its cap', async () => {
    await expect(
      readAutopilotInput('-', 'summary', {
        cwd: '/unused',
        stdin: chunks('x'.repeat(70_000)),
        stdinIsTty: false
      })
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: expect.stringMatching(/too large/)
    })
  })
})
