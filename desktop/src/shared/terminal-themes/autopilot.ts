import type { TerminalThemeMap } from './types'

// Frozen D12 Paper terminal pair; see DESIGN.md. Every ANSI text color clears
// 4.5:1 against its background; Charcoal is the default in both app themes.
// Freeze adjustments: Charcoal selection lightened to clear 2:1 against CLI
// instruction blocks with white text; Paper white/brightWhite darkened so CLI
// body text stays >= 4.5:1 on paper. Define round 1: Charcoal ANSI chroma raised
// about 1.3x (bright 1.2x) at fixed lightness so pass/warn/diff colours read apart.

// Why: pane dividers sit between charcoal (or paper) terminals; one source for defaults and fallbacks.
export const AUTOPILOT_TERMINAL_DIVIDER_DARK = '#46423b'
export const AUTOPILOT_TERMINAL_DIVIDER_LIGHT = '#cfc9c0'

export const AUTOPILOT_TERMINAL_THEMES: TerminalThemeMap = {
  'Autopilot Charcoal': {
    background: '#1b1915',
    foreground: '#e9e4dc',
    cursor: '#df816d',
    cursorAccent: '#1b1915',
    selectionBackground: '#896d61',
    selectionForeground: '#ffffff',
    black: '#312d28',
    red: '#f17d76',
    green: '#65bc6a',
    yellow: '#cd9c18',
    blue: '#57a9fa',
    magenta: '#df7fc0',
    cyan: '#10bcbc',
    white: '#d1cdc7',
    brightBlack: '#85817b',
    brightRed: '#fea199',
    brightGreen: '#8bd28d',
    brightYellow: '#e1b85d',
    brightBlue: '#89c3fe',
    brightMagenta: '#f19fd6',
    brightCyan: '#46d6d5',
    brightWhite: '#f5f1ec'
  },
  'Autopilot Paper': {
    background: '#fdfaf6',
    foreground: '#272117',
    cursor: '#aa4d39',
    cursorAccent: '#fdfaf6',
    selectionBackground: '#f4cec5',
    selectionForeground: '#272117',
    black: '#272117',
    red: '#a03f3c',
    green: '#27762f',
    yellow: '#7e5e01',
    blue: '#1666aa',
    magenta: '#92417a',
    cyan: '#067272',
    white: '#67635c',
    brightBlack: '#695f50',
    brightRed: '#873330',
    brightGreen: '#1d6225',
    brightYellow: '#694e03',
    brightBlue: '#0d5590',
    brightMagenta: '#7b3467',
    brightCyan: '#005f5f',
    brightWhite: '#514c46'
  }
}
