import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgyOutputCapture, finalizeAgyOutput } from './agy-exec-output'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agy-exec-output-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// FIXTURE_ONLY: the credential-shaped values are obviously fake.
const FAKE_KEY = `sk-${'FIXTURE0'.repeat(4)}`

describe('createAgyOutputCapture', () => {
  it('keeps the head of the output and counts every byte it saw', () => {
    const capture = createAgyOutputCapture(10)
    capture.write(Buffer.from('hello '))
    capture.write('world, and more')
    expect(capture.bytes().toString('utf8')).toBe('hello worl')
    expect(capture.totalBytes()).toBe(6 + 15)
    expect(capture.overflowed()).toBe(true)
  })

  it('reports overflow once, exactly when the cap is first exceeded, and not at the cap', () => {
    const onOverflow = vi.fn()
    const capture = createAgyOutputCapture(10, onOverflow)
    capture.write('0123456789')
    expect(onOverflow).not.toHaveBeenCalled()
    expect(capture.overflowed()).toBe(false)
    capture.write('x')
    capture.write('y')
    expect(onOverflow).toHaveBeenCalledTimes(1)
  })

  it('does not grow past the cap however much a chatty child writes', () => {
    const capture = createAgyOutputCapture(1024)
    for (let index = 0; index < 500; index += 1) {
      capture.write(Buffer.alloc(4096, 97))
    }
    expect(capture.bytes().length).toBe(1024)
    expect(capture.totalBytes()).toBe(500 * 4096)
  })
})

describe('finalizeAgyOutput', () => {
  const outputPath = (): string => join(dir, 'output.txt')

  it('writes the captured bytes to the run directory and records path, size and SHA-256', async () => {
    const capture = createAgyOutputCapture(4096)
    capture.write('The draft is ready.\n')
    const record = await finalizeAgyOutput(capture, { path: outputPath(), maxPreviewChars: 200 })
    const raw = Buffer.from('The draft is ready.\n')
    expect(record).toEqual({
      state: 'ok',
      path: outputPath(),
      bytes: raw.length,
      sha256: createHash('sha256').update(raw).digest('hex'),
      secretLike: false,
      preview: 'The draft is ready.\n',
      previewTruncated: false
    })
    expect(readFileSync(outputPath())).toEqual(raw)
  })

  it('redacts and bounds the preview but keeps the file byte-exact, and flags a credential shape', async () => {
    const capture = createAgyOutputCapture(1 << 20)
    capture.write(`key=${FAKE_KEY} ${'z'.repeat(5000)}`)
    const record = await finalizeAgyOutput(capture, { path: outputPath(), maxPreviewChars: 100 })
    expect(record.state).toBe('ok')
    if (record.state !== 'ok') {
      return
    }
    expect(record.secretLike).toBe(true)
    expect(record.preview).not.toContain(FAKE_KEY)
    expect(record.preview.length).toBeLessThanOrEqual(100)
    expect(record.previewTruncated).toBe(true)
    expect(readFileSync(outputPath(), 'utf8')).toContain(FAKE_KEY)
  })

  it('creates the file private and never writes through an existing file or link', async () => {
    writeFileSync(outputPath(), 'planted')
    const capture = createAgyOutputCapture(64)
    capture.write('answer')
    const record = await finalizeAgyOutput(capture, { path: outputPath(), maxPreviewChars: 50 })
    expect(record).toMatchObject({ state: 'unwritable', path: null })
    expect(readFileSync(outputPath(), 'utf8')).toBe('planted')
  })

  it.skipIf(process.platform === 'win32')(
    'creates the output file with owner-only permissions',
    async () => {
      const capture = createAgyOutputCapture(64)
      capture.write('answer')
      await finalizeAgyOutput(capture, { path: outputPath(), maxPreviewChars: 50 })
      expect(statSync(outputPath()).mode & 0o777).toBe(0o600)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refuses to write through a planted symlink',
    async () => {
      const target = join(dir, 'victim.txt')
      writeFileSync(target, 'victim')
      symlinkSync(target, outputPath())
      const capture = createAgyOutputCapture(64)
      capture.write('answer')
      const record = await finalizeAgyOutput(capture, { path: outputPath(), maxPreviewChars: 50 })
      expect(record.state).toBe('unwritable')
      expect(readFileSync(target, 'utf8')).toBe('victim')
    }
  )

  it('reports empty output and writes no file for it', async () => {
    for (const text of ['', '   \n\t\n']) {
      const capture = createAgyOutputCapture(64)
      capture.write(text)
      const record = await finalizeAgyOutput(capture, { path: outputPath(), maxPreviewChars: 50 })
      expect(record).toMatchObject({ state: 'empty', path: null, sha256: null })
      expect(existsSync(outputPath())).toBe(false)
    }
  })

  it('reports oversized output, keeps the total seen and writes no file', async () => {
    const capture = createAgyOutputCapture(8)
    capture.write('0123456789abcdef')
    const record = await finalizeAgyOutput(capture, { path: outputPath(), maxPreviewChars: 50 })
    expect(record).toMatchObject({
      state: 'oversized',
      path: null,
      bytes: 16,
      sha256: null,
      preview: ''
    })
    expect(existsSync(outputPath())).toBe(false)
  })

  it('reports an unwritable run directory instead of throwing', async () => {
    const capture = createAgyOutputCapture(64)
    capture.write('answer')
    const record = await finalizeAgyOutput(capture, {
      path: join(dir, 'missing-dir', 'output.txt'),
      maxPreviewChars: 50
    })
    expect(record).toMatchObject({ state: 'unwritable', path: null })
  })

  it('handles a multi-byte character without splitting it in the preview', async () => {
    const capture = createAgyOutputCapture(1 << 16)
    capture.write('\u{1F600}'.repeat(100))
    const record = await finalizeAgyOutput(capture, { path: outputPath(), maxPreviewChars: 11 })
    expect(record.state === 'ok' && record.preview).toBe('\u{1F600}'.repeat(5))
  })

  it('scans a large output for credential shapes in linear time', async () => {
    mkdirSync(join(dir, 'big'))
    const capture = createAgyOutputCapture(4 * 1024 * 1024)
    capture.write(`${'eyJ-'.repeat(200_000)}`)
    const started = performance.now()
    const record = await finalizeAgyOutput(capture, {
      path: join(dir, 'big', 'output.txt'),
      maxPreviewChars: 100
    })
    expect(record.state).toBe('ok')
    expect(performance.now() - started).toBeLessThan(2000)
  })
})
