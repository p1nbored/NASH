import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// Why read the catalog: the shipped build resolves a key from en.json, not from the inline
// default, so changing copy under an existing key leaves the old words on screen.
const HostRemoveDialogCopySchema = z.object({
  auto: z.object({
    components: z.object({
      sidebar: z.object({ HostRemoveDialog: z.record(z.string(), z.string()) })
    })
  })
})

const dialog = HostRemoveDialogCopySchema.parse(
  JSON.parse(readFileSync(join(__dirname, '../../i18n/locales/en.json'), 'utf8'))
).auto.components.sidebar.HostRemoveDialog

describe('WSL host removal copy', () => {
  it('ships the copy that says removal ends the host’s terminals', () => {
    expect(dialog.wslHostEndsTerminals).toBe(
      'Removes {{value0}} from Orca, ends its open terminals and stops Orca’s server in that distro. Files in the distro are untouched.'
    )
    expect(dialog).not.toHaveProperty('wslHost')
  })
})
