import { act, fireEvent, within } from '@testing-library/react'
import { vi, type Mock } from 'vitest'

// FIXTURE_ONLY: a clipboard stub for "Copy details" render tests.
export type ClipboardWrite = Mock<(text: string) => Promise<void>>

export function installClipboard(): ClipboardWrite {
  const write: ClipboardWrite = vi.fn(async () => undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { ui: { writeClipboardText: write } }
  })
  return write
}

export function removeClipboard(): void {
  Reflect.deleteProperty(window, 'api')
}

/** Clicks the first "Copy details" button inside `container` and returns what it copied. */
export async function copyDetailsText(
  container: HTMLElement,
  write: ClipboardWrite
): Promise<string> {
  write.mockClear()
  const [button] = within(container).getAllByRole('button', { name: 'Copy details' })
  await act(async () => {
    fireEvent.click(button)
  })
  return write.mock.calls.at(-1)?.[0] ?? ''
}
