import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { runOxlintPluginOnSource } from './oxlint-plugin-test-runner.mjs'

const directory = mkdtempSync(path.join(import.meta.dirname, '.anti-slop-scope-'))
const source = path.dirname(createRequire(import.meta.url).resolve('oxlint-plugin-anti-slop'))
cpSync(source, directory, { recursive: true })
afterAll(() => rmSync(directory, { recursive: true, force: true }))

function lint(source, rule) {
  return runOxlintPluginOnSource({
    pluginName: 'anti-slop',
    pluginPath: path.join(directory, 'index.ts'),
    rules: { [`anti-slop/${rule}`]: 'error' },
    source,
    extension: 'ts'
  })
}

it.each([
  ['const value = {}; const wide: unknown = value; wide as { id: string };', 1],
  ['const value = {}; const alias = value; const wide: unknown = alias; <{ id: string }>wide;', 1],
  ['function parse(input: unknown) { return input as { id: string }; }', 0],
  ['const value = {}; let wide: unknown = value; wide as { id: string };', 0],
  ['const value = {}; const wide: unknown = value; function read() { return wide as {}; }', 0],
  [
    'const value = {}; const wide: unknown = value; function read(wide: unknown) { return wide as {}; }',
    0
  ],
  ['const value = {}; const wide: unknown = value; wide as unknown;', 0]
])('preserves widening evidence and lexical boundaries: %s', (source, count) => {
  expect(lint(source, 'no-widen-then-assert')).toHaveLength(count)
})

it.each([
  ["import { vi as test } from 'vitest'; test.mock('module');", 1],
  ["import { jest as test } from '@jest/globals'; test['doMock']('module');", 1],
  ["jest.unstable_mockModule('module', () => ({}));", 1],
  ["vi['mock']('module');", 1],
  ["import { vi } from 'vitest'; vi.mocked(value);", 0],
  ["const unrelated = { mock() {} }; unrelated.mock('module');", 0],
  ["const vi = { mock() {} }; vi.mock('module');", 0],
  ["import { vi as test } from 'vitest'; function run(test) { test.mock('module'); }", 0]
])('preserves mock method and owner resolution: %s', (source, count) => {
  expect(lint(source, 'no-module-mocking')).toHaveLength(count)
})
