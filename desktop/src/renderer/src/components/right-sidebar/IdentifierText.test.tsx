import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import IdentifierText from './IdentifierText'

function textOf(markup: string): string {
  return markup.replaceAll('<wbr/>', '')
}

describe('IdentifierText', () => {
  it('offers a line break after each separator run without changing the copied text', () => {
    const value = 'fixture-repo-autopilot::C:/fixtures/autopilot/feature-evidence-contracts'
    const markup = renderToStaticMarkup(<IdentifierText value={value} />)
    expect(textOf(markup)).toBe(value)
    expect(markup.match(/<wbr\/>/g)).toHaveLength(4)
    expect(markup).toContain('::<wbr/>C:/<wbr/>fixtures/<wbr/>autopilot/<wbr/>feature')
  })

  it('handles Windows separators and values without separators', () => {
    expect(renderToStaticMarkup(<IdentifierText value={'C:\\work\\repo'} />)).toBe(
      'C:\\<wbr/>work\\<wbr/>repo'
    )
    expect(renderToStaticMarkup(<IdentifierText value="local" />)).toBe('local')
  })
})
