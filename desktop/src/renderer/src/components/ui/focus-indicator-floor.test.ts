import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const UI_DIR = __dirname
const CLASS_STRING = /["'`]([^"'`]*focus[^"'`]*)["'`]/g
const HALF_TRANSPARENT_RING = /(?:^|\s)\S*ring-ring\/\d+/
const SOLID_FOCUS_INDICATOR =
  /(focus-visible:border-ring|focus-visible:outline|ring-2 \S*ring-ring(\s|$)|:ring-ring(\s|$))/

// Why: a translucent ring alone measured about 2:1; every focusable primitive needs a solid
// indicator (ring, border or outline) that clears the direction's 3:1 non-text floor.
describe('ui primitive focus indicators', () => {
  const files = readdirSync(UI_DIR).filter(
    (name) => name.endsWith('.tsx') && !name.includes('.test.')
  )

  it.each(files)('%s never relies on a translucent ring alone', (file) => {
    const source = readFileSync(join(UI_DIR, file), 'utf8')
    for (const [, classes] of source.matchAll(CLASS_STRING)) {
      if (HALF_TRANSPARENT_RING.test(classes)) {
        expect(classes, file).toMatch(SOLID_FOCUS_INDICATOR)
      }
    }
  })
})
