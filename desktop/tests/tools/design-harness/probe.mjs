// Boot probe: starts the harness dev server on loopback, renders it in
// Playwright Chromium and saves one screenshot plus console diagnostics.
// Usage: node tests/tools/design-harness/probe.mjs <out.png> [width] [height] [waitMs]
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { resolve } from 'node:path'

const here = import.meta.dirname
const [
  outPath = resolve(here, 'probe.png'),
  width = '1440',
  height = '900',
  waitMs = '20000',
  query = '',
  activate = ''
] = process.argv.slice(2)
const withTimeout = (label, promise, ms = 15000) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms))
  ])

const server = await createServer({ configFile: resolve(here, 'vite.config.ts'), logLevel: 'warn' })
await server.listen()
const url = server.resolvedUrls.local[0]
// Why: reuse the locally cached Chromium instead of downloading the pinned build.
const browser = await chromium.launch({ executablePath: process.env.DESIGN_HARNESS_CHROMIUM })
const messages = []
const result = { url }
try {
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } })
  page.on('console', (msg) => messages.push(`${msg.type()}: ${msg.text().slice(0, 200)}`))
  page.on('pageerror', (err) =>
    messages.push(`pageerror: ${String(err.stack ?? err).slice(0, 600)}`)
  )
  page.on('response', (res) => {
    if (res.status() >= 400) {
      messages.push(`http ${res.status()} ${res.url()}`)
    }
  })
  await withTimeout('goto', page.goto(url + query, { waitUntil: 'load' }), 120000)
  await new Promise((r) => setTimeout(r, Number(waitMs)))
  if (activate) {
    result.activated = await withTimeout(
      'activate',
      page.evaluate((id) => window.__store?.getState().setActiveWorktree(id), activate)
    )
    await new Promise((r) => setTimeout(r, 6000))
  }
  try {
    result.textLength = await withTimeout(
      'evaluate',
      page.evaluate(() => document.body.innerText.length)
    )
    result.store = await withTimeout(
      'store',
      page.evaluate(() => {
        const st = window.__store?.getState()
        if (!st) {
          return null
        }
        return {
          repos: st.repos?.map((r) => r.id),
          worktreesByRepo: Object.fromEntries(
            Object.entries(st.worktreesByRepo ?? {}).map(([k, v]) => [k, v.length])
          ),
          activeRepoId: st.activeRepoId,
          activeWorktreeId: st.activeWorktreeId,
          tabs: Object.fromEntries(
            Object.entries(st.tabsByWorktree ?? {}).map(([k, v]) => [k, v.map((t) => t.id)])
          ),
          activeView: st.activeView,
          hydrationSucceeded: st.hydrationSucceeded
        }
      })
    )
    result.html = await withTimeout(
      'html',
      page.evaluate(() => document.getElementById('root')?.innerHTML.slice(0, 400))
    )
  } catch (error) {
    result.evaluateError = String(error)
  }
  try {
    await withTimeout('screenshot', page.screenshot({ path: outPath }), 20000)
  } catch (error) {
    result.screenshotError = String(error)
  }
} catch (error) {
  result.fatal = String(error)
} finally {
  result.messages = messages
  result.count = messages.length
  console.log(JSON.stringify(result, null, 2))
  await withTimeout('browser.close', browser.close(), 10000).catch(() => {})
  await withTimeout('server.close', server.close(), 10000).catch(() => {})
  process.exit(0)
}
