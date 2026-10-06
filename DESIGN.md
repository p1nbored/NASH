# Design

The product identity is **D12 Paper** (decision D-009): an original, Anthropic-inspired developer workspace built on Orca's own components. It uses warm paper neutrals, restrained clay accents, a selective editorial serif, precise controls and a terminal-first density. It has no brand affiliation and copies no proprietary assets or fonts.

The canonical source is `desktop/src/renderer/src/assets/main.css`. `desktop/docs/STYLEGUIDE.md` still governs component usage and enforcement; where it describes Orca's former monochrome identity, this file and the token tests win.

## Tokens

| Role | Light | Dark | Rule |
|---|---|---|---|
| Canvas (`--background`) | `#fbf5ed` | `#1a1712` | Warm paper, never pure grey |
| Card / editor surface | `#fdfaf6` | `#201d18` | Working content sits slightly above the canvas |
| Sidebar | `#f2ece3` | `#16120d` | One step darker than the canvas, read as a recess |
| Ink (`--foreground`) | `#272117` | `#ece7e0` | At least 7:1 on every surface |
| Muted text | `#695f50` | `#aaa499` | At least 4.5:1 on every surface |
| Primary (clay) | `#aa4d39` | `#dc836f` | Primary actions only; never focus, never decoration |
| Focus ring (`--ring`) | `#695f50` | `#aaa499` | Neutral ink, solid, at least 3:1; matches the host-owned security chrome |
| Destructive | `#c1054d` | `#ec6484` | Crimson, at least 0.08 OKLab and 20 degrees of hue from clay |
| Border / input | `#e3dcd3` / `#cfc9c0` | `#343029` / `#46423b` | Hairline dividers; inputs one step stronger |
| Status warning | `#936605` | `#e8bd6d` | Blocked or pending states, always with a label and icon |

- **Security chrome:** the `--orca-security-*` tokens equal their app counterparts, except that the security primary is neutral ink, so a plugin can never disguise a consent decision as a clay call to action.
- **Shape:** the corner radius is 6px (`--radius: 0.375rem`).

## Typography

- **Display:** Georgia (`font-display`). Used only for page titles, dialog and sheet titles, settings subsection headings and Workbench section headings, at regular weight.
- **Controls and body:** `system-ui`, at 13–14px.
- **Code and terminal:** the platform monospace (Cascadia Mono on Windows), at the user's configured size and weight.
- **Hierarchy:** section headings are a step larger than field labels, never smaller or lighter.

## Terminal and editor

- **Autopilot Charcoal** (`#1b1915` background, `#e9e4dc` text) is the default terminal in both app themes; **Autopilot Paper** is the built-in light alternative.
  - Every ANSI text colour clears 4.5:1 on its background.
  - Charcoal's six semantic colours keep an OKLCH chroma of at least 0.12, so pass, warning and diff lines read apart from plain output.
- **Monaco:** uses `autopilot-light` and `autopilot-dark`, registered before any editor mounts. Their surface, ink and line-number colours equal the app tokens.

## Component rules

- **Focus:** every focusable primitive shows a solid indicator (ring, border or outline). Translucent halos alone are not allowed (enforced by `ui/focus-indicator-floor.test.ts`).
- **Disabled primary buttons:** use an outlined muted surface at full opacity rather than a faded clay fill.
- **Toggle groups:** mark the selected segment with an inset outline that never competes with the focus ring.
- **Identifiers and paths:** wrap only at separators (`IdentifierText`), and copied text stays exact.
- **Blocked or failed states:** shown with a label, an icon and the warning or destructive token, never by colour alone. Fixture, replay and live data stay labelled.

## Verification

- **Token and component guarantees:** each guarantee above has a test. These include `autopilot-theme-tokens.test.ts`, `terminal-themes/autopilot.test.ts`, `monaco-theme.test.ts`, `ui/button.test.tsx`, `ui/toggle.test.tsx` and `settings-typography-hierarchy.test.tsx`.
- **Visual review:** follows the fixed screenshot-only rubric and `docs/design/review-policy.json`. The initial review (round 0) scored 66–79 and was blocked; its record and triage (`docs/design/define/round-0/`) were archived outside the repository on 2026-10-04. Revision rounds use the isolated headless critic (`scripts/design/critic-round.mjs`), which writes each round to the git-ignored `.local/define/<round>/`.
- **Visual scores** never establish functional, accessibility, security or lifecycle correctness.
