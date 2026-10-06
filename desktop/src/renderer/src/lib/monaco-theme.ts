import type { editor } from 'monaco-editor'

// Frozen D12 Paper editor themes (decision D-009). Monaco paints its own
// background, so these mirror main.css editor-surface/foreground/muted tokens;
// monaco-theme.test.ts fails if the two drift apart.
export const AUTOPILOT_MONACO_THEMES = {
  'autopilot-light': {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#fdfaf6',
      'editor.foreground': '#272117',
      'editorLineNumber.foreground': '#695f50',
      'editorLineNumber.activeForeground': '#272117',
      'editor.lineHighlightBackground': '#f1ebe4',
      'editor.selectionBackground': '#f4cec5',
      'editorCursor.foreground': '#aa4d39',
      'editorGutter.background': '#fdfaf6'
    }
  },
  'autopilot-dark': {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#201d18',
      'editor.foreground': '#ece7e0',
      'editorLineNumber.foreground': '#aaa499',
      'editorLineNumber.activeForeground': '#ece7e0',
      'editor.lineHighlightBackground': '#26231e',
      'editor.selectionBackground': '#513934',
      'editorCursor.foreground': '#dc836f',
      'editorGutter.background': '#201d18'
    }
  }
} as const satisfies Record<string, editor.IStandaloneThemeData>

export type AutopilotMonacoThemeName = keyof typeof AUTOPILOT_MONACO_THEMES

export function monacoThemeName(isDark: boolean): AutopilotMonacoThemeName {
  return isDark ? 'autopilot-dark' : 'autopilot-light'
}

type MonacoThemeRegistry = {
  editor: { defineTheme: (name: string, data: editor.IStandaloneThemeData) => void }
}

export function defineAutopilotMonacoThemes(monaco: MonacoThemeRegistry): void {
  for (const [name, data] of Object.entries(AUTOPILOT_MONACO_THEMES)) {
    monaco.editor.defineTheme(name, { ...data, rules: [...data.rules] })
  }
}
