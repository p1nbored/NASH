import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
// TypeScript 7 is a native CLI; AST tests still need the legacy JavaScript API.
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'
import { isRecoverableRemoteRuntimeConnectionError } from '../../../shared/remote-runtime-client-error-classification'
import {
  INLINE_ORCA_ALLOWED,
  KEPT_ORCA_CATALOG_KEYS,
  ORCA_SERVICE_PHRASES,
  PRODUCT_TOKEN,
  RETIRED_IDENTITY_VALUES
} from './nash-product-name.test-fixture'

const RENDERER_ROOT = resolve('src/renderer/src')
const LOCALIZATION_FUNCTIONS = new Set([
  't',
  'translate',
  'translateMain',
  'translateSearchKeyword'
])
// Why: the user types these into a terminal outside NASH, where only the `nash` command is on PATH.
const RETIRED_COMMAND =
  /(?<![\w./-])orca (?:serve|worktree|browser|status|terminal|emulator)\b|`orca`/
// Why: src/shared retries these transport failures by matching their text, so a rename must keep that match.
const TRANSPORT_ERROR =
  /remote \S+ runtime (?:is not connected|connection closed|closed the connection)|could not connect to the remote \S+ runtime/i

function collectProductionFiles(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const filePath = resolve(dir, name)
    if (statSync(filePath).isDirectory()) {
      if (name !== 'locales') {
        collectProductionFiles(filePath, files)
      }
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.|test-fixture/.test(name)) {
      files.push(filePath)
    }
  }
  return files
}

function localizationKeyForFallback(node: ts.Node): string | null {
  const call = node.parent
  if (!call || !ts.isCallExpression(call) || call.arguments[1] !== node) {
    return null
  }
  const callee = call.expression
  const name = ts.isIdentifier(callee)
    ? callee.text
    : ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ''
  const key = call.arguments[0]
  return LOCALIZATION_FUNCTIONS.has(name) && key && ts.isStringLiteralLike(key) ? key.text : null
}

function visibleText(node: ts.Node): string | null {
  if (
    ts.isStringLiteralLike(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    ts.isJsxText(node)
  ) {
    const parent = node.parent
    const isModulePath =
      parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))
    return isModulePath ? null : node.text
  }
  return null
}

function isAllowed(file: string, text: string, key: string | null): boolean {
  if (key && key in KEPT_ORCA_CATALOG_KEYS) {
    return true
  }
  const withoutPhrases = ORCA_SERVICE_PHRASES.en.reduce((value, re) => value.replace(re, ''), text)
  const namesOrca = PRODUCT_TOKEN.en.test(withoutPhrases) || RETIRED_COMMAND.test(withoutPhrases)
  return (
    !namesOrca ||
    INLINE_ORCA_ALLOWED.some((entry) => entry.file === file && withoutPhrases.includes(entry.text))
  )
}

type ScanResult = { naming: string[]; retired: string[]; unclassifiedTransport: string[] }

function scanRenderer(): ScanResult {
  const naming: string[] = []
  const retired: string[] = []
  const unclassifiedTransport: string[] = []
  for (const filePath of collectProductionFiles(RENDERER_ROOT)) {
    const source = readFileSync(filePath, 'utf8')
    if (!/Orca|orca/.test(source) && !TRANSPORT_ERROR.test(source)) {
      continue
    }
    const file = relative(RENDERER_ROOT, filePath).split(sep).join('/')
    const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind)
    const visit = (node: ts.Node): void => {
      const text = visibleText(node)
      if (text !== null) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        if (!isAllowed(file, text, localizationKeyForFallback(node))) {
          naming.push(`${file}:${line}: ${text.trim().slice(0, 120)}`)
        }
        if (RETIRED_IDENTITY_VALUES.some((value) => text.toLowerCase().includes(value))) {
          retired.push(`${file}:${line}: ${text.trim().slice(0, 120)}`)
        }
        if (
          TRANSPORT_ERROR.test(text) &&
          !isRecoverableRemoteRuntimeConnectionError({ message: text })
        ) {
          unclassifiedTransport.push(`${file}:${line}: ${text.trim().slice(0, 120)}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return { naming, retired, unclassifiedTransport }
}

describe('NASH product name in renderer source (D-017)', () => {
  const result = scanRenderer()

  it('names the app NASH in inline copy and translate() fallbacks', () => {
    expect(result.naming).toEqual([])
  })

  it('never shows the orca:// scheme or the ~/.orca folder', () => {
    expect(result.retired).toEqual([])
  })

  it('keeps remote-runtime transport errors in the wording src/shared retries on', () => {
    expect(result.unclassifiedTransport).toEqual([])
  })
})
