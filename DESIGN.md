# Design

The product identity is **D12 Paper** (decision D-009): an original, Anthropic-inspired developer workspace built on Orca's own components. It uses warm paper neutrals, restrained clay accents, a selective editorial serif, precise controls and a terminal-first density. It has no brand affiliation and copies no proprietary assets or fonts.

The canonical source is `desktop/src/renderer/src/assets/main.css`. `desktop/docs/STYLEGUIDE.md` governs component usage and enforcement. Every colour, size, space, radius and state below is a token or a primitive variant; component code does not hard-code them.

## Tokens

### Surfaces and text

| Role | Light | Dark | Rule |
|---|---|---|---|
| Canvas (`--background`) | `#fbf5ed` | `#1a1712` | Warm paper, never pure grey |
| Card, popover and editor surface | `#fdfaf6` | `#201d18` | Working content and floating layers sit slightly above the canvas |
| Sidebar | `#f2ece3` | `#16120d` | One step darker than the canvas, read as a recess |
| Ink (`--foreground`) | `#272117` | `#ece7e0` | At least 7:1 on every surface |
| Muted text | `#695f50` | `#aaa499` | At least 4.5:1 on every surface |
| Primary (clay) | `#aa4d39` | `#dc836f` | Primary actions only; never focus, selection or decoration |
| Focus ring (`--ring`) | `#695f50` | `#aaa499` | Neutral ink, solid, at least 3:1; matches the host-owned security chrome |
| Destructive | `#c1054d` | `#ec6484` | Crimson, at least 0.08 OKLab and 20 degrees of hue from clay |
| Border (`--border`) | `#e3dcd3` | `#343029` | Decorative hairline between related groups; never the only edge of a control |
| Input (`--input`) | `#cfc9c0` | `#46423b` | Dark-mode field fill (`bg-input/30`) and quiet inset outlines |

### States

| Role | Utility | Light | Dark | Rule |
|---|---|---|---|---|
| Hover | `bg-hover` | `--accent` `#ece6de` | `--accent` `#2f2b25` | Rows, ghost and outline controls, toggles |
| Selected | `bg-selected`, `text-selected-foreground` | `#e3ddd4`, ink | `#3a352d`, ink | A step stronger than hover: the active menu, select and command item, and persistent selections; a persistent selection adds a second cue (weight, check icon or an inset `control` ring) |
| Control edge | `border-control`, `bg-control`, `inset-ring-control` | `#8a8174` | `#7a7469` | Fields, checkboxes, switch tracks, strong dividers: at least 3:1 on canvas, card, popover, muted and sidebar |
| Disabled text | `text-disabled-foreground` | `#8a8174` | `#7a7469` | At least 3:1 yet quieter than muted text; disabled fields keep full opacity |
| Floating edge | `border-floating-border` | `#d6cec3` | `#48433b` | Menus, popovers, select lists, hover cards, dialogs, sheets, toasts |
| Floating shadow | `shadow-floating` | warm ink 16% | black 50% | The only elevation above a hairline; themed through `--floating-shadow` |
| Scrim | `bg-scrim` | canvas ink 50% | black 60% | Behind dialogs, sheets and the command palette |

Hover and selected text map straight to `--accent` and `--foreground` in the Tailwind theme, so they follow scoped overrides (custom left-sidebar appearance, sleeping-card dimming).

### Status

| Family | Text (`text-status-*`) light / dark | Background and border |
|---|---|---|
| Success | `#2b6b3d` / `#88ca95` | `bg-status-success-background` (10% tint), `border-status-success-border` (25% tint) |
| Warning | `#7e5804` / `#e8bd6d` | `bg-status-warning-background`, `border-status-warning-border` |
| Error | `#b70549` / `#fb7292` | `bg-status-error-background`, `border-status-error-border` |

Status text clears 4.5:1 on every surface and on its own tint there; light success and warning were darkened one step (from `#317a45` and `#936605`) when that check was added. Error is the destructive crimson tuned for text on tints. A status is never shown by colour alone: it always has a label and, where space allows, an icon.

- **Security chrome:** the `--orca-security-*` tokens equal their app counterparts, except that the security primary is neutral ink, so a plugin can never disguise a consent decision as a clay call to action.

## Typography

### Families

- **UI (`font-sans`):** `--app-font-family` (default `system-ui`, then `-apple-system`, BlinkMacSystemFont, 'Segoe UI'), then `--app-cjk-font-family`, then `sans-serif`. The `appFontFamily` setting replaces only the first part, so a chosen font still keeps the CJK fallbacks behind it.
- **CJK:** bundled Noto Sans CJK for navigation, controls and body text; bundled Noto Serif CJK for main titles. Both full-coverage fonts use the document's language tag and OpenType `locl` for regional glyph forms. The two assets serve every supported language, without runtime font downloads or OS font dependencies.
- **Display (`font-display`):** Georgia, Iowan Old Style, Charter or Cambria for Latin text, followed by bundled Noto Serif CJK. Use regular weight only for page, dialog and sheet main titles and editorial summaries. Compact Settings and Workbench group headings use `font-sans text-heading font-semibold`. The same roles apply to every language.
- **Code (`font-mono`):** SF Mono, Cascadia Mono, Cascadia Code, Menlo, Consolas, then the CJK sans for wide characters. Terminals and editors use the user's configured family, size and weight.
- **Bundled font provenance:** Noto Sans CJK SC variable, [Sans 2.004](https://github.com/notofonts/noto-cjk/tree/Sans2.004/Sans/Variable/OTF), and Noto Serif CJK SC Regular, [Serif 2.003](https://github.com/notofonts/noto-cjk/tree/Serif2.003/Serif/OTF/SimplifiedChinese). Full glyph coverage and language substitutions are preserved by WOFF2 compression with fontTools 4.66.1. Font sources have SHA-256 `2745e9681cb9d8a5c8901b62c9e1bd98c9c774365fc3b84dd467621013b51cd3` and `2a2eae2628df83556c54018c41e20fa532c1b862c5256ae8b3f23feb918d12ca`. The SIL Open Font License is shipped at `desktop/resources/licenses/NotoCJK-OFL.txt`. No new application dependency or font-loading code is needed.

### Scale

| Utility | Size / line | Use |
|---|---|---|
| `text-caption` | 11 / 16 | Timestamps, counts, tertiary metadata |
| `text-meta` | 12 / 16 | Secondary text, paths, helper text, menu items (equals `text-xs`) |
| `text-body` | 13 / 20 | Dense rows, sidebar items, default UI text |
| `text-body-lg` | 14 / 20 | Setting labels, button text, reading text (equals `text-sm`) |
| `text-heading` | 15 / 22 | Section and group headings |
| `text-title` | 20 / 28 | Page and dialog titles, with `font-display` (equals `text-xl`) |
| `text-display` | 26 / 34 | Rare editorial headers, with `font-display` |

Section headings are a step larger than the labels beneath them, never smaller or lighter. Tailwind's default sizes still work; new code uses the token names. `cn()` registers these names through `extendTailwindMerge` (see STYLEGUIDE.md, Typography).

## Spacing

| Utility suffix | Value | Use |
|---|---|---|
| `row` (`p-row`, `gap-row`) | 8px | Inside a row or control group |
| `group` (`gap-group`, `py-group`) | 16px | Between related rows; card padding |
| `section` (`mt-section`) | 24px | Between sections of a page |

The numeric Tailwind scale (4px steps) stays available for component internals.

## Shape and elevation

| Utility | Radius | Use |
|---|---|---|
| `rounded-sm` | 4px | Badges and chips, checkboxes |
| `rounded-md` | 6px (`--radius`) | Buttons, inputs, selects, menu and list items |
| `rounded-lg` | 8px | Cards, popovers, menus, panels, toasts |
| `rounded-xl` | 10px | Dialogs and the command palette |

`rounded-2xl` to `rounded-4xl` are capped at 10px. `rounded-full` is reserved for tracks and thumbs (switch, slider, progress, scrollbar) and the `counter` badge. Edge-attached sheets stay square.

Elevation has three levels: a hairline border (default), the hairline plus `shadow-xs` for rare embedded lifts, and `shadow-floating` for layers above the page. Floating layers are opaque paper (`bg-popover`), never translucent glass.

## Terminal and editor

- **Autopilot Charcoal** (`#1b1915` background, `#e9e4dc` text) is the default terminal in both app themes; **Autopilot Paper** is the built-in light alternative.
  - Every ANSI text colour clears 4.5:1 on its background.
  - Charcoal's six semantic colours keep an OKLCH chroma of at least 0.12, so pass, warning and diff lines read apart from plain output.
- **Monaco:** uses `autopilot-light` and `autopilot-dark`, registered before any editor mounts. Their surface, ink and line-number colours equal the app tokens.

## Component rules

- **Focus:** every focusable primitive shows a solid ink indicator: `ring-2 ring-ring` for buttons, toggles, tabs and checkboxes; `border-ring` plus `ring-1 ring-ring` for fields. The default outline colour is solid `--ring`. Translucent halos are not allowed.
- **Buttons:** variants `default` (one per flow), `secondary`, `outline`, `ghost`, `link`, `destructive`; sizes `xs` 24px, `sm` 32px, `default` 36px, `lg` 40px and the matching `icon-*` squares. Disabled primaries use an outlined muted surface at full opacity rather than a faded clay fill.
- **Fields:** `Input` sizes `default` 36px, `sm` 32px, `xs` 28px. Fields, textareas and select triggers draw their edge with `border-control`; disabled fields use `bg-muted`, a hairline and `text-disabled-foreground` at full opacity.
- **Checked controls:** checkboxes and switches use ink, not clay. The unchecked switch track is `bg-control`, so the thumb reads at 3:1.
- **Selection:** toggle segments, menu items, select options and command items use `bg-selected`; toggle segments add an inset `control` ring that never competes with the focus ring.
- **Badges:** 4px chips. Status chips use the `success`, `warning` or `error` variant with a label; `counter` is the only pill.
- **Cards:** flat paper with a hairline border, `rounded-lg`, 16px padding and no shadow. Do not nest cards; prefer an unframed section.
- **Dividers:** `Separator` (`default` hairline); `variant="strong"` (`bg-control`) for structural splits that must read at 3:1.
- **Identifiers and paths:** wrap only at separators (`IdentifierText`), and copied text stays exact.
- **Blocked or failed states:** shown with a label, an icon and the warning or error token, never by colour alone. Fixture, replay and live data stay labelled.

## Verification

- **Token and component guarantees:** each guarantee above has a test: `assets/autopilot-theme-tokens.test.ts` (contrast, state colours, font stacks), `assets/design-token-utilities.test.ts` (compiles `main.css` and checks every token utility), `ui/primitive-tokens.test.ts` (no raw colours, shadows, radii, glass or halos in primitives), `ui/button.test.tsx`, `ui/badge.test.tsx`, `ui/card.test.tsx`, `ui/input.test.tsx`, `ui/separator.test.tsx`, `ui/toggle.test.tsx`, `ui/focus-indicator-floor.test.ts`, `i18n/document-language.test.ts`, `lib/app-font-family.test.ts`, `terminal-themes/autopilot.test.ts`, `monaco-theme.test.ts` and `settings-typography-hierarchy.test.tsx`.
- **Visual review:** follows the fixed screenshot-only rubric and `docs/design/review-policy.json`. The initial review (round 0) scored 66–79 and was blocked; its record and triage (`docs/design/define/round-0/`) were archived outside the repository on 2026-10-04. Revision rounds use the isolated headless critic (`scripts/design/critic-round.mjs`), which writes each round to the git-ignored `.local/define/<round>/`.
- **Visual scores** never establish functional, accessibility, security or lifecycle correctness.
