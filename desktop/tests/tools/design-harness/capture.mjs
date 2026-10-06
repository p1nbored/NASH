// Captures the real renderer through the fixture harness for design review.
// Usage:
//   node tests/tools/design-harness/capture.mjs --out DIR [--tokens FILE]
//     [--directions baseline,D11,D12,D13] [--themes light,dark] [--viewports 1440x900]
//     [--views terminal,settings]
// Writes PNGs plus capture-manifest.json with source/token/image hashes.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const here = import.meta.dirname
const orcaRoot = resolve(here, '../../..')
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const NAVIGATION_TIMEOUT_MS = 120_000
const WARMUP_TIMEOUT_MS = 300_000
const WARMUP_ATTEMPTS = 2

function parseArgs(argv) {
  const options = {
    directions: 'baseline',
    themes: 'light',
    viewports: '1440x900',
    views: 'terminal'
  }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, '')
    if (!['out', 'tokens', 'directions', 'themes', 'viewports', 'views'].includes(key)) {
      throw new Error(`Unknown option ${argv[index]}`)
    }
    options[key] = argv[index + 1]
  }
  if (!options.out) {
    throw new Error('--out DIR is required')
  }
  return options
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.includes(`${sep}node_modules${sep}`))
    .sort()
}

// Why a tree digest: binds each capture to the exact renderer and harness bytes.
async function treeDigest(roots) {
  const hash = createHash('sha256')
  for (const root of roots) {
    for (const path of await listFiles(root)) {
      hash.update(relative(orcaRoot, path).split(sep).join('/'))
      hash.update('\0')
      hash.update(await readFile(path))
      hash.update('\0')
    }
  }
  return hash.digest('hex')
}

function cachedChromium() {
  if (process.env.DESIGN_HARNESS_CHROMIUM) {
    return process.env.DESIGN_HARNESS_CHROMIUM
  }
  const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  const candidate = join(base, 'chromium-1224', 'chrome-win64', 'chrome.exe')
  return existsSync(candidate) ? candidate : undefined
}

async function loadDirection(tokens, id) {
  if (id === 'baseline') {
    return null
  }
  const record = tokens.directions.find((direction) => direction.id === id)
  if (!record) {
    throw new Error(`Direction ${id} is not in the token file`)
  }
  const css = await readFile(resolve(dirname(tokens.path), `${id}.exploration.css`), 'utf8')
  // Why settings: Orca writes --app-font-family inline from appFontFamily.
  const appFontFamily = record.sans === 'geist' ? 'Geist' : 'Segoe UI Variable Text'
  return { id, css, terminal: record.terminal, appFontFamily }
}

async function settle(page) {
  await page.waitForFunction(() => window.__store?.getState().hydrationSucceeded === true, null, {
    timeout: 60000
  })
  await page.waitForFunction(() => (window.__harnessTerminalScripts ?? 0) >= 1, null, {
    timeout: 30000
  })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(1500)
}

// Why: a cold Vite start pre-bundles and transforms the renderer on first load,
// which can outlast a navigation timeout and may reload the page mid-load.
async function warmUp(browser, url) {
  for (let attempt = 1; attempt <= WARMUP_ATTEMPTS; attempt += 1) {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      await page.goto(`${url}?theme=light`, { waitUntil: 'load', timeout: WARMUP_TIMEOUT_MS })
      await page.waitForFunction(
        () => window.__store?.getState().hydrationSucceeded === true,
        null,
        {
          timeout: WARMUP_TIMEOUT_MS
        }
      )
      return
    } catch (error) {
      if (attempt === WARMUP_ATTEMPTS) {
        throw error
      }
    } finally {
      await context.close()
    }
  }
}

async function captureOne(browser, url, spec, outDir) {
  const context = await browser.newContext({ viewport: spec.viewport, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)))
  if (spec.direction) {
    await page.addInitScript((direction) => {
      window.__designDirection = direction
    }, spec.direction)
  }
  await page.goto(`${url}?theme=${spec.theme}`, {
    waitUntil: 'load',
    timeout: NAVIGATION_TIMEOUT_MS
  })
  await settle(page)
  if (spec.view !== 'terminal') {
    await page.evaluate((view) => window.__store.getState().setActiveView(view), spec.view)
    await page.waitForTimeout(2000)
  }
  const observed = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    documentTheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    effectiveSettings: (() => {
      const settings = window.__store?.getState().settings
      return {
        appFontFamily: settings?.appFontFamily ?? null,
        terminalThemeLight: settings?.terminalThemeLight ?? null,
        terminalThemeDark: settings?.terminalThemeDark ?? null,
        terminalCustomThemes: settings?.terminalCustomThemes?.length ?? 0
      }
    })(),
    fonts: ['Geist', 'Georgia', 'Cambria', 'Segoe UI', 'Cascadia Mono'].filter((family) =>
      document.fonts.check(`14px "${family}"`)
    )
  }))
  const file = `${spec.id}.png`
  const image = await page.screenshot({ path: join(outDir, file), animations: 'disabled' })
  await context.close()
  return {
    id: spec.id,
    file,
    direction: spec.direction?.id ?? 'baseline',
    theme: spec.theme,
    scenario: spec.view === 'terminal' ? 'workspace-dense' : `${spec.view}-default`,
    requested_viewport: spec.viewport,
    observed,
    image_sha256: sha256(image),
    page_errors: errors,
    retouched: false,
    redactions: []
  }
}

const options = parseArgs(process.argv.slice(2))
const outDir = resolve(options.out)
await mkdir(outDir, { recursive: true })
const tokensPath = options.tokens ? resolve(options.tokens) : null
const tokens = tokensPath
  ? { ...JSON.parse(await readFile(tokensPath, 'utf8')), path: tokensPath }
  : { directions: [] }
const specs = []
for (const directionId of options.directions.split(',')) {
  const direction = await loadDirection(tokens, directionId)
  for (const theme of options.themes.split(',')) {
    for (const size of options.viewports.split(',')) {
      const [width, height] = size.split('x').map(Number)
      for (const view of options.views.split(',')) {
        const label = view === 'terminal' ? 'workspace' : view
        specs.push({
          id: `${directionId}-${label}-${theme}-${size}`,
          direction,
          theme,
          view,
          viewport: { width, height }
        })
      }
    }
  }
}

const server = await createServer({ configFile: resolve(here, 'vite.config.ts'), logLevel: 'warn' })
await server.listen()
const browser = await chromium.launch({ executablePath: cachedChromium() })
const chromiumVersion = browser.version()
const captures = []
try {
  await warmUp(browser, server.resolvedUrls.local[0])
  for (const spec of specs) {
    captures.push(await captureOne(browser, server.resolvedUrls.local[0], spec, outDir))
  }
} finally {
  await browser.close()
  await server.close()
}

const manifest = {
  schema_version: 1,
  kind: 'real_renderer_fixture_harness',
  status: 'FIXTURE_ONLY',
  captured_at: new Date().toISOString(),
  renderer: 'desktop/orca/src/renderer (Vite dev server, fixture preload, Playwright Chromium)',
  limitations: [
    'Fixture preload: no Electron main process, runtime daemon, PTY or user data.',
    'Terminal panes render scripted fixture bytes through real xterm.js, not a live process.',
    'Browser Chromium build differs from the Electron shell; window chrome is renderer-drawn.'
  ],
  source: {
    renderer_and_harness_tree_sha256: await treeDigest([
      join(orcaRoot, 'src', 'renderer', 'src'),
      here
    ]),
    token_file: tokensPath
      ? relative(resolve(orcaRoot, '../..'), tokensPath).split(sep).join('/')
      : null,
    token_file_sha256: tokensPath ? sha256(await readFile(tokensPath)) : null,
    chromium: chromiumVersion
  },
  captures
}
await writeFile(join(outDir, 'capture-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ outDir, captures: captures.map((c) => [c.id, c.page_errors.length]) }))
process.exit(0)
