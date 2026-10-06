import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readBoundedFromHandle, readLastMessage } from './codex-exec-last-message'

let root = ''

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'codex-exec-last-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readLastMessage', () => {
  it('reports a missing file', async () => {
    expect(await readLastMessage(join(root, 'nope.txt'), 1024)).toEqual({ state: 'missing' })
  })

  it('reports an empty or whitespace-only file as empty', async () => {
    const empty = join(root, 'empty.txt')
    writeFileSync(empty, '')
    expect(await readLastMessage(empty, 1024)).toEqual({ state: 'empty' })
    const blank = join(root, 'blank.txt')
    writeFileSync(blank, ' \r\n\t \n')
    expect(await readLastMessage(blank, 1024)).toEqual({ state: 'empty' })
  })

  it('returns text, byte length and a SHA-256 for a non-empty file', async () => {
    const path = join(root, 'ok.txt')
    writeFileSync(path, '﻿result 你好\n', 'utf8')
    const result = await readLastMessage(path, 1024)
    expect(result).toMatchObject({ state: 'ok', text: 'result 你好\n', secretLike: false })
    if (result.state === 'ok') {
      expect(result.bytes).toBe(Buffer.byteLength('﻿result 你好\n', 'utf8'))
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('refuses a file larger than the cap without reading it whole', async () => {
    const path = join(root, 'big.txt')
    writeFileSync(path, 'x'.repeat(2048))
    expect(await readLastMessage(path, 1024)).toEqual({ state: 'oversized', bytes: 2048 })
  })

  it('accepts a file of exactly the cap', async () => {
    const path = join(root, 'exact.txt')
    writeFileSync(path, 'x'.repeat(1024))
    expect(await readLastMessage(path, 1024)).toMatchObject({ state: 'ok', bytes: 1024 })
  })

  it('reports a directory at the path as unreadable rather than throwing', async () => {
    const path = join(root, 'a-dir')
    mkdirSync(path)
    const result = await readLastMessage(path, 1024)
    expect(result.state).toBe('unreadable')
  })

  it('refuses a symbolic link instead of following it to another file', async (context) => {
    const target = join(root, 'link-target.txt')
    const link = join(root, 'link.txt')
    writeFileSync(target, 'content behind a link')
    try {
      symlinkSync(target, link)
    } catch {
      context.skip()
    }
    expect(await readLastMessage(link, 1024)).toEqual({ state: 'unreadable', code: 'SYMLINK' })
  })
})

describe('readLastMessage secret flag', () => {
  // FIXTURE_ONLY: the credential below is obviously fake.
  it('flags a message that contains a credential shape, and only then', async () => {
    const leaky = join(root, 'leaky.txt')
    writeFileSync(leaky, 'summary: ghp_FIXTUREONLYFIXTUREONLYFIXTUREONLY1234 was in the config')
    expect(await readLastMessage(leaky, 4096)).toMatchObject({ state: 'ok', secretLike: true })
    const clean = join(root, 'clean.txt')
    writeFileSync(clean, 'summary: nothing sensitive here')
    expect(await readLastMessage(clean, 4096)).toMatchObject({ state: 'ok', secretLike: false })
  })

  it('keeps the text unredacted: the flag is advice, the file is the deliverable', async () => {
    const path = join(root, 'raw.txt')
    writeFileSync(path, 'token=FIXTUREONLYvalue123')
    const result = await readLastMessage(path, 4096)
    expect(result).toMatchObject({ state: 'ok', text: 'token=FIXTUREONLYvalue123' })
  })

  it('scans a multi-megabyte adversarial message in under 200 ms', async () => {
    const path = join(root, 'adversarial.txt')
    writeFileSync(path, 'eyJ-'.repeat(1024 * 1024))
    const started = performance.now()
    const result = await readLastMessage(path, 8 * 1024 * 1024)
    expect(result.state).toBe('ok')
    expect(performance.now() - started).toBeLessThan(200)
  })
})

describe('readBoundedFromHandle', () => {
  const endlessHandle = () => {
    let reads = 0
    return {
      reads: () => reads,
      read: async (buffer: Buffer, offset: number, length: number) => {
        reads += 1
        buffer.fill(0x61, offset, offset + length)
        return { bytesRead: length }
      }
    }
  }

  it('stops one byte past the cap even when the file keeps growing', async () => {
    const handle = endlessHandle()
    const result = await readBoundedFromHandle(handle, 100_000)
    expect(result.truncated).toBe(true)
    expect(result.bytes.length).toBe(100_001)
    expect(handle.reads()).toBeLessThan(10)
  })

  it('returns everything of a file shorter than the cap', async () => {
    const data = Buffer.from('hello world')
    let consumed = 0
    const handle = {
      read: async (buffer: Buffer, offset: number, length: number) => {
        const chunk = data.subarray(consumed, consumed + length)
        chunk.copy(buffer, offset)
        consumed += chunk.length
        return { bytesRead: chunk.length }
      }
    }
    const result = await readBoundedFromHandle(handle, 1024)
    expect(result.truncated).toBe(false)
    expect(result.bytes.toString('utf8')).toBe('hello world')
  })
})
