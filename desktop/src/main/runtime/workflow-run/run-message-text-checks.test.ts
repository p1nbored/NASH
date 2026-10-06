import { describe, expect, it } from 'vitest'
import { RUN_MESSAGE_TEXT_MAX_CHARS } from '../orchestration/db/autopilot-message-schema-definition'
import { prepareRunMessageText, runMessageTextSha256 } from './run-message-text-checks'

// FIXTURE_ONLY: the credential-shaped string below is synthetic and grants nothing.
const BIDI_OVERRIDE = String.fromCodePoint(0x202e)
const LINE_SEPARATOR = String.fromCodePoint(0x2028)
const FAKE_KEY_TEXT = 'Use api_key=0123456789abcdef0123456789abcdef for the call.'

describe('run message text preparation', () => {
  it.each([
    'Please also update the CHANGELOG.',
    'Line one.\nLine two, with "quoted text" and `src/main.ts`.',
    'Keep the title “Über die Brücke” exactly as written.',
    '请检查文件。',
    'Bitte prüfe die Datei.',
    'Tab\tseparated.',
    `Bidi ${BIDI_OVERRIDE} override.`,
    `Line${LINE_SEPARATOR}separator.`,
    FAKE_KEY_TEXT,
    `Quote "${FAKE_KEY_TEXT}" please.`
  ])('accepts and keeps unchanged (D-027 restriction 35): %j', (text) => {
    expect(prepareRunMessageText(text)).toEqual({ ok: true, text })
  })

  it.each([
    ['End the paste \u001b[201~ early.', 'End the paste ␛[201~ early.'],
    ['Clear the screen \u001b[2J now.', 'Clear the screen ␛[2J now.'],
    ['C1 \u009b201~ here.', 'C1 �201~ here.'],
    ['Bell \u0007 and NUL \u0000.', 'Bell ␇ and NUL ␀.'],
    ['Interrupt \u0003 here.', 'Interrupt ␃ here.'],
    ['Delete \u007f here.', 'Delete ␡ here.'],
    ['Windows\r\nline\rendings.', 'Windows\nline\nendings.'],
    ['Lone \ud800 surrogate.', 'Lone � surrogate.']
  ])(
    'neutralises terminal controls that could end the paste frame, refusing nothing: %j',
    (text, typed) => {
      expect(prepareRunMessageText(text)).toEqual({ ok: true, text: typed })
    }
  )

  it.each([
    ['', 'text_empty'],
    ['   \n  ', 'text_empty'],
    ['a'.repeat(RUN_MESSAGE_TEXT_MAX_CHARS + 1), 'text_too_long']
  ])('refuses %j with %s', (text, reason) => {
    expect(prepareRunMessageText(text)).toEqual({ ok: false, reason })
  })

  it('accepts any number of quoted spans (D-027)', () => {
    const text = `Names: ${Array.from({ length: 40 }, (_, i) => `"n${i}"`).join(' ')}.`
    expect(prepareRunMessageText(text)).toEqual({ ok: true, text })
  })

  it('has only a 64 Ki code point technical ceiling, counted as the table does', () => {
    expect(RUN_MESSAGE_TEXT_MAX_CHARS).toBe(65_536)
    // Astral characters are two UTF-16 units each, so the UTF-16 length is twice the ceiling.
    const within = '\u{1F600}'.repeat(RUN_MESSAGE_TEXT_MAX_CHARS)
    expect(within.length).toBeGreaterThan(RUN_MESSAGE_TEXT_MAX_CHARS)
    expect(prepareRunMessageText(within)).toEqual({ ok: true, text: within })
    expect(prepareRunMessageText(`${within}a`)).toEqual({ ok: false, reason: 'text_too_long' })
  })

  it('hashes the exact text so a replay with other text is detected', () => {
    expect(runMessageTextSha256('a')).toMatch(/^[0-9a-f]{64}$/)
    expect(runMessageTextSha256('a')).not.toBe(runMessageTextSha256('a\n'))
  })

  it('exposes only the preparation and the hash, not its internal refusal list', async () => {
    const exported = Object.keys(await import('./run-message-text-checks')).sort()
    expect(exported).toEqual(['prepareRunMessageText', 'runMessageTextSha256'])
  })
})
