// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginOrcaCatalogSetting } from './PluginOrcaCatalogSetting'

type OnChange = (enabled: boolean) => Promise<void>

const roots: Root[] = []

async function render(
  enabled: boolean,
  onChange: OnChange
): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<PluginOrcaCatalogSetting enabled={enabled} onChange={onChange} />)
  })
  return { container, root }
}

function catalogSwitch(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    '[aria-labelledby="orca-plugin-catalog-label"]'
  )
  if (!element) {
    throw new Error('missing Orca plugin catalog switch')
  }
  return element
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ''
})

describe('PluginOrcaCatalogSetting', () => {
  it('names the switch and says what it downloads', async () => {
    const { container } = await render(false, vi.fn<OnChange>())

    expect(container.querySelector('#orca-plugin-catalog-label')?.textContent).toBe(
      "Use Orca's plugin catalog"
    )
    expect(container.textContent).toContain(
      "Downloads Orca's official plugin list and plugin safety list from Orca's servers."
    )
    expect(catalogSwitch(container).getAttribute('aria-checked')).toBe('false')
  })

  it('turns the catalog on, and off again', async () => {
    const onChange = vi.fn<OnChange>().mockResolvedValue(undefined)
    const { container, root } = await render(false, onChange)

    await act(async () => click(catalogSwitch(container)))
    expect(onChange).toHaveBeenLastCalledWith(true)

    await act(async () => {
      root.render(<PluginOrcaCatalogSetting enabled onChange={onChange} />)
    })
    expect(catalogSwitch(container).getAttribute('aria-checked')).toBe('true')
    await act(async () => click(catalogSwitch(container)))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('locks the switch while saving and reports a failed save', async () => {
    let rejectSave: (error: Error) => void = () => {}
    const onChange = vi.fn<OnChange>(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject
        })
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = await render(false, onChange)

    await act(async () => click(catalogSwitch(container)))
    expect(catalogSwitch(container).hasAttribute('disabled')).toBe(true)

    await act(async () => rejectSave(new Error('disk full')))

    expect(catalogSwitch(container).hasAttribute('disabled')).toBe(false)
    expect(container.textContent).toContain('Could not save plugin settings.')
    warn.mockRestore()
  })
})
