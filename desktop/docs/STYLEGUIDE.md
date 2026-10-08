# NASH UI Style Guide

This is the **UI/visual design** doc for NASH (built on Orca) — color tokens, typography, component selection, and UX rules. It is _not_ an architecture doc; for system-level design see code and inline comments. Token values live in `src/renderer/src/assets/main.css` (canonical); the root `DESIGN.md` records the D12 Paper direction and every token value; this file documents the _roles and rules_ for using them.

## Overview

NASH is an Electron desktop app for orchestrating coding agents across git worktrees. The visual identity is **D12 Paper**: warm paper neutrals and ink carry the chrome, a restrained clay marks the single primary action, and color otherwise means state (focus, selection, status, destructive, git decorations). The product spends most of its time hosting other tools (Monaco, xterm, Markdown previews), so its own UI should recede and frame.

When in doubt:

- Reach for **muted/accent/border** before reaching for color.
- Reach for a **token utility** (`text-meta`, `gap-group`, `bg-hover`, `border-control`) before an arbitrary value (`text-[12px]`, `bg-[#…]`).
- Match the nearest **shadcn primitive and its variants** before writing custom classes.

## Source of truth

| Concern                                       | Canonical location                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| Color tokens                                  | `src/renderer/src/assets/main.css` (`:root`, `.dark`)                  |
| Tailwind theme bindings                       | Same file: `@theme inline { … }` (colors, radii, shadow)               |
| Type scale and spacing roles                  | Same file: `@theme static { … }`                                       |
| Font stacks and bundled CJK families        | Same file: `@font-face` and `:root`                       |
| Component primitives                          | `src/renderer/src/components/ui/` (shadcn-style)                       |
| Token values and rationale                    | Root `DESIGN.md`                                                       |
| App typography / scrollbars / titlebar chrome | Same `main.css`                                                        |

Never hardcode a hex value in component code if a variable already covers it. If a new token is needed, add it to `main.css` (both `:root` and `.dark`), expose it in the `@theme inline` block, add it to the token tests, then use it.

## Color roles

Tokens come in pairs: a **surface** and a **foreground** that meets contrast on it. Always use them together.

| Role                                     | Use it for                                                  | Don't use it for                                    |
| ---------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `background` / `foreground`              | App canvas, default text                                    | Cards, popovers, sidebar (have their own)           |
| `card` / `card-foreground`               | Panels lifted off the canvas                                | The canvas itself                                   |
| `popover` / `popover-foreground`         | Floating menus, dropdowns, hovercards                       | Inline UI                                           |
| `primary` / `primary-foreground`         | The single affirmative action in a flow (Save, Confirm)     | Decorative accents; hover states; secondary actions |
| `secondary` / `secondary-foreground`     | Lower-emphasis actions next to a primary                    | The affirmative action                              |
| `muted` / `muted-foreground`             | De-emphasized text, captions, placeholders, disabled chrome | Body copy; primary actions                          |
| `accent` / `accent-foreground`           | Hover/active backgrounds for ghost buttons and list rows    | Solid filled buttons (use `secondary` instead)      |
| `destructive` / `destructive-foreground` | Delete, discard, irreversible-action buttons                | Cancel buttons (Cancel is not destructive)          |
| `border`                                 | Decorative hairlines: dividers, card edges                  | The only edge of an interactive control             |
| `input`                                  | Dark-mode field fill (`bg-input/30`), quiet inset outlines  | Anywhere outside form fields                        |
| `ring`                                   | Focus-visible outlines (solid ink)                          | Persistent decoration; selection                    |

### State roles

| Utility                                   | Use it for                                                                 | Don't use it for                          |
| ----------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------- |
| `bg-hover`                                | Hover on rows, ghost and outline controls (the accent role)                | Persistent selection                      |
| `bg-selected` / `text-selected-foreground` | The selected row, segment, menu or command item                            | Hover; decoration                         |
| `border-control` / `bg-control`           | Edges that identify a control: fields, checkboxes, switch tracks; strong dividers | Decorative dividers (use `border`)   |
| `text-disabled-foreground`                | Text in disabled fields and controls at full opacity                       | Placeholder or secondary text             |
| `text-status-{success,warning,error}`, `bg-status-*-background`, `border-status-*-border` | Status text, chips and callouts, always with a label | Git status; decorative color |
| `border-floating-border`, `shadow-floating`, `bg-popover` | Every floating layer (menus, popovers, dialogs, sheets, toasts) | Inline panels (use `card`)       |
| `bg-scrim`                                | Backdrop behind dialogs, sheets and the command palette                    | Anything else                             |

Values and contrast rules are in the root `DESIGN.md`; `assets/autopilot-theme-tokens.test.ts` enforces them.
| `sidebar` (+ variants)                   | The worktree sidebar and its children                       | Other panels                                        |
| `editor-surface`                         | Background of Monaco / markdown editor panes                | App chrome                                          |

The `sidebar` family expands into `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, and `--sidebar-ring` — use them inside the worktree sidebar so its hover/selected/focus states stay consistent and don't bleed into other panels. `editor-surface` is its own token (not just `background`) because Monaco and the markdown editor have a slightly darker surface in dark mode to match VS Code conventions; reach for it whenever you're rendering an editor pane.

### Git decoration colors

For diff status, file-tree decorations, and the changes view, use the git decoration tokens (mirroring VS Code's palette so users transferring from VS Code aren't surprised):

| Token                        | State          |
| ---------------------------- | -------------- |
| `--git-decoration-added`     | Added / new    |
| `--git-decoration-modified`  | Modified       |
| `--git-decoration-deleted`   | Deleted        |
| `--git-decoration-renamed`   | Renamed        |
| `--git-decoration-untracked` | Untracked      |
| `--git-decoration-copied`    | Copied         |
| `--git-decoration-ignored`   | Ignored by git |

Use these _only_ for git status. Don't reuse them for unrelated state colors — that breaks the convention.

### List rows: hover, selected, current

A common point of drift. Use these conventions for any list-style row (worktrees, command palette items, settings nav):

- **Idle:** transparent background.
- **Hover:** `bg-hover` (in the worktree sidebar, `bg-sidebar-accent`).
- **Keyboard-selected (cmdk, menu and select highlight):** `bg-selected text-selected-foreground`. The `CommandItem`, `SelectItem`, `DropdownMenuItem` and `ContextMenuItem` primitives already apply it. The jump palette keeps its own recipe in `main.css` (`.jump-palette-item[data-selected='true']`): `color-mix` foreground into background plus an inset ring, exposed as `--jump-palette-selection-surface` for nested cutouts (status pips).
- **Persistent "current" / "active" row** (e.g. the worktree the user is viewing): `bg-selected` _plus_ a second cue (weight, check icon, or `inset-ring-1 inset-ring-control`) and a `data-current="true"` attribute so CSS can distinguish it from the cmdk highlight.
- **Don't:** hardcode `bg-[#ededed]` / `bg-[#333333]` or invent another "selected" color.
- **Inside scoped overrides** (custom left-sidebar appearance): `bg-hover` and `text-selected-foreground` follow the scoped `--accent`/`--foreground`; prefer the `sidebar-*` family there.

### Color mixing

When you need a tint (e.g. a 12% primary wash on hover), use `color-mix` against the existing token, not a new hex:

```css
background: color-mix(in srgb, var(--primary) 12%, var(--background));
```

This keeps light/dark parity automatic.

## Typography

- **Families:** `font-sans` is for navigation, controls, labels, body text and compact group headings. It combines the user's UI font with bundled Noto Sans CJK. `font-display` is reserved for page, dialog and sheet main titles and editorial summaries: Georgia plus bundled Noto Serif CJK, at regular weight. `font-mono` is for terminals, code, paths and literal identifiers. Apply these roles identically in every language; do not set all headings in serif. Geist remains an optional UI font.
- **Languages:** `<html lang>` follows the UI language. The two bundled full-coverage Noto CJK fonts use OpenType `locl` to choose Simplified Chinese, Traditional Chinese, Japanese and Korean glyph forms. The `sc` asset filename selects the default only; these are not region-subset fonts. No font is downloaded at runtime. Sources and license are recorded in root `DESIGN.md`.
- **Body letter-spacing:** `0.01em` (set globally on `body`). Don't override per component.
- **Sizes:** use the type scale utilities, not `text-[Npx]`:

| Utility        | Size / line | Use                                                        |
| -------------- | ----------- | ---------------------------------------------------------- |
| `text-caption` | 11 / 16     | Timestamps, counts, uppercase category labels (with `font-semibold uppercase tracking-wider`) |
| `text-meta`    | 12 / 16     | Sub-text, paths, helper text, trailing metadata, menu items |
| `text-body`    | 13 / 20     | Sidebar items, dense list rows, default UI text            |
| `text-body-lg` | 14 / 20     | Setting labels, button text in the `default` size          |
| `text-heading` | 15 / 22     | Section and group headings                                 |
| `text-title`   | 20 / 28     | Page and dialog titles, with `font-display`                |
| `text-display` | 26 / 34     | Rare editorial headers, with `font-display`                |

`text-xs` (= meta), `text-sm` (= body-lg) and `text-xl` (= title) remain valid and are what the primitives use internally.

- **`cn()` and the type scale:** `lib/utils.ts` registers every semantic type and spacing token with `extendTailwindMerge`, so token sizes remain intact beside text colors and spacing overrides.

## Spacing

Use the numeric scale (4px steps) inside components, and the spacing roles between them: `row` 8px (inside a row or control group), `group` 16px (between related rows, card padding), `section` 24px (between page sections) — for example `gap-row`, `space-y-group`, `mt-section`.

## Radius

`--radius: 0.375rem` (6px) is the base. `rounded-sm` 4px (badges, chips, checkboxes), `rounded-md` 6px (buttons, inputs, selects, menu items), `rounded-lg` 8px (cards, popovers, menus, panels, toasts), `rounded-xl` 10px (dialogs, command palette). `rounded-2xl` and above are capped at 10px. `rounded-full` is for tracks, thumbs and the `counter` badge only. Match the primitive's radius rather than introducing a new one; never use `rounded-[Npx]`.

## Elevation & shadows

Shadows are rare. Three levels:

1. **Hairline** — `border` + `border` token. The default. Almost everything sits at this level, including cards.
2. **Subtle lift** — `shadow-xs` + a single-token border. Rare embedded lifts.
3. **Floating** — `shadow-floating` (themed by `--floating-shadow`) with `border-floating-border` on an opaque `bg-popover`. Menus, popovers, dialogs, sheets, toasts.

Don't add a fourth level, and don't use translucent glass (`bg-white/80`, `backdrop-blur-xl`) for surfaces. If something needs more emphasis than "floating," you're probably reaching for the focus `ring` instead.

## Components

Use the shadcn primitives in `src/renderer/src/components/ui/` before writing anything custom. The shadcn-style wrappers in this folder follow a consistent pattern:

- Most carry a `data-slot="<name>"` attribute on their root for CSS targeting — do not strip it. (The non-shadcn helpers in this folder — `sonner` and `repo-multi-combobox` — don't follow this pattern and shouldn't be modeled when adding new primitives that should.)
- Use `cn()` for class merging. Pass user `className` last so callers can override.
- Use `class-variance-authority` (CVA) for variants when there are multiple.

### Buttons (`button.tsx`)

Variants in priority order:

| Variant       | Use case                                                           |
| ------------- | ------------------------------------------------------------------ |
| `default`     | The single affirmative action in a flow.                           |
| `secondary`   | Lower-emphasis sibling next to a `default`.                        |
| `outline`     | Toolbar / standalone actions where a filled button feels heavy.    |
| `ghost`       | Icon buttons, list-row triggers, anywhere chrome should disappear. |
| `link`        | Inline text actions inside paragraphs.                             |
| `destructive` | Delete, discard, irreversible. Never for Cancel.                   |

Sizes: `default` (36px), `sm` (32px), `xs` (24px), `lg` (40px), plus `icon`, `icon-xs`, `icon-sm`, `icon-lg`. Match the size to the surrounding row height — don't drop a `default` button into a 28px toolbar.

### Fields, badges, cards and dividers

- **`Input`:** `size` `default` (36px), `sm` (32px, `text-xs`), `xs` (28px, `text-xs`). Use the size instead of `className="h-8 text-xs"`. Fields, `Textarea` and `SelectTrigger` draw their edge with `border-control` (3:1 or more), focus with `border-ring` plus a 1px `ring-ring`, and disable with `bg-muted` and `text-disabled-foreground` at full opacity.
- **`Badge`:** 4px chips. `success`, `warning` and `error` are the status chips (tint, edge and text from the status family; always with a label); `counter` is the only pill, for counts. `default`, `secondary`, `outline`, `ghost`, `link`, `destructive`, `dot` and `hostContext` keep working.
- **`Card`:** flat paper, `rounded-lg`, hairline `border-border`, 16px padding, no shadow. Avoid nesting cards; prefer an unframed section or a divider.
- **`Separator`:** the default is the decorative hairline; `variant="strong"` (`bg-control`) marks a structural split that must read at 3:1.
- **`Checkbox` / `Switch`:** checked state is ink, not clay; the unchecked switch track is `bg-control`.

### Other primitives in this repo

Browse `src/renderer/src/components/ui/` for the full list. Most wrap a Radix UI primitive — exceptions are `command` (wraps `cmdk`), `sonner` (wraps `sonner`), and the visual-only wrappers (`badge`, `button-group`, `card`, `input`) which apply tokens and Tailwind utilities directly. Never reimplement headless behavior; extend the existing wrapper.

### Picking the right primitive

When a control has multiple plausible primitives, use this fork:

| You want…                                                    | Reach for                                  | Don't use                             |
| ------------------------------------------------------------ | ------------------------------------------ | ------------------------------------- |
| Hover-only label on an icon-only button                      | `Tooltip`                                  | `HoverCard` (too heavy), title attr   |
| Hover preview of richer content (avatar + summary)           | `HoverCard`                                | `Tooltip` (no rich content)           |
| Click-revealed menu with actions                             | `DropdownMenu`                             | `Popover` with hand-rolled list       |
| Right-click contextual actions                               | `ContextMenu`                              | `DropdownMenu` (different invocation) |
| Click-revealed surface with arbitrary content (form, picker) | `Popover`                                  | `Dialog` (it traps focus and dims)    |
| Modal that demands a decision before you continue            | `Dialog`                                   | `Popover`, inline overlay             |
| Drawer / panel sliding in from an edge                       | `Sheet`                                    | `Dialog` centered                     |
| Single choice from a known list                              | `Select`                                   | Custom listbox                        |
| Single choice with search / fuzzy filtering                  | `Command` inside `Popover`                 | `Select` (no search)                  |
| Multi-select with search                                     | `repo-multi-combobox` (mirror its pattern) | Roll a new one                        |
| Transient confirmation ("Saved", "Copied")                   | `sonner` toast                             | `Dialog`, inline banner               |
| Persistent inline status ("3 errors")                        | inline text + `Badge`                      | toast (toasts disappear)              |

If you find yourself styling around a primitive (`<Popover>` to act like a `<Dialog>`, or vice versa), stop and reconsider — the focus-management semantics differ and a future contributor will be misled by the mismatch.

### Tooltips

Tooltips exist to _name_ a control whose meaning isn't obvious from its appearance. They are not the place to teach, persuade, or warn — anything users need to read while acting belongs in the visible UI.

- **Use a tooltip when:** an icon-only button or compact chip needs a label. Toolbar icons, badges with abbreviations, truncated paths.
- **Don't use a tooltip when:** the control already has a visible label, the content is interactive (links, buttons), or the message is critical (errors, blocking warnings — those go inline).
- **Mounting:** the global `<TooltipProvider delayDuration={400}>` lives at the App root. Don't nest a second `TooltipProvider` unless you need a different delay for a tightly-scoped surface.
- **Trigger pattern:** wrap the trigger element with `<TooltipTrigger asChild>` so the tooltip's accessibility props attach to the button (not a wrapper span). This is required for keyboard focus to surface the tooltip.
- **Placement:** default `side="top" sideOffset={4}` — match the toolbar pattern in `sidebar/SidebarToolbar.tsx`. Pick a different side only when the default would clip against the viewport.
- **Shortcut chips inside tooltips:** if the action has a keyboard shortcut, append `<ShortcutKeyCombo />` rather than baking the keys into the label string. The chips render correctly per platform; baked-in strings drift.

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button variant="ghost" size="icon-sm" onClick={openSettings}>
      <Settings />
    </Button>
  </TooltipTrigger>
  <TooltipContent side="top" sideOffset={4}>
    Settings
  </TooltipContent>
</Tooltip>
```

### Icons

Icons come from **`lucide-react`**. Don't import a second icon library.

- **Default size:** `size-4` (16px). `Button` auto-applies this to any `<svg>` it contains via `[&_svg:not([class*='size-'])]:size-4`, so most call sites don't need to set a size on the icon.
- **`size-3` / `size-3.5`:** for metadata, captions, and dense list rows where 16px is too loud.
- **`size-7`+:** for featured/empty-state hero icons only.
- **Stroke width:** lucide's default 2px. Don't override per-icon.
- **Color:** inherit from surrounding text — `text-muted-foreground` for secondary, `text-destructive` for destructive, etc. Don't apply a token to the SVG directly when the parent already carries the right color.
- **Spinner:** the canonical loading icon is `<Loader2 className="size-4 animate-spin" />`. For 3s+ multi-step work, prefer a label that names the stage ("Cloning…" → "Installing…") over an unlabeled spinner. See _UX rule 1_.

### Keyboard shortcut chips

Use **`<ShortcutKeyCombo />`** from `src/renderer/src/components/ShortcutKeyCombo.tsx`. It renders a consistent key-cap style and inserts a `+` separator on Windows/Linux (Mac shows adjacent glyphs, no separator). It does **not** transform key strings — the _caller_ picks the platform-appropriate labels and passes them in:

```tsx
const isMac = navigator.userAgent.includes('Mac')
const mod = isMac ? '⌘' : 'Ctrl'
const shift = isMac ? '⇧' : 'Shift'
<ShortcutKeyCombo keys={[mod, shift, 'N']} />
```

See `Landing.tsx` for the canonical pattern. Don't roll a one-off `<kbd>` — kbd chips drift in shape and color across the app fast if everyone styles their own.

**Where shortcuts surface in the UI:**

- **Tooltips on icon buttons** — append the chip after the label, trailing.
- **Dropdown / context-menu items** — use `<DropdownMenuShortcut>` (or its context-menu equivalent) for the right-aligned chip; don't position one yourself.
- **Never on Cancel, Dismiss, or `link`-variant inline actions** — see _UX rule 3_.

**The label MUST match the actual binding for the platform.** If the keyboard handler reads `metaKey` on Mac and `ctrlKey` elsewhere, the chip must show `⌘` on Mac and `Ctrl` elsewhere. Mismatched chips are worse than no chip.

### Form anatomy

The pattern in `src/renderer/src/components/settings/SettingsFormControls.tsx` is the house style for any label + control + helper text. Match it for new forms:

- **Outer stack:** `space-y-3` for full-section forms (`ThemePicker`); `space-y-2` for compact single-control fields (`ColorField`, `NumberField`). Pick by density, not preference.
- **Label group:** `space-y-1` containing `<Label>` and a description in `text-meta text-muted-foreground` (`text-xs` inside `cn()` until it knows the type scale).
- **Control:** the shadcn primitive (`<Input>`, `<Select>`, etc.). Errors surface via `aria-invalid`; the input primitive already maps that to a destructive border — don't paint your own. Persistent error text below a field uses `text-status-error`.
- **Trailing metadata:** `text-caption text-muted-foreground` below the control (e.g., "Current: 14px · Default: 13px"), not next to the label.

### Scrollbars

Three scrollbar classes are defined globally in `main.css`:

- **`.scrollbar-sleek`** — the default thin, neutral scrollbar for sidebars, lists, popovers. Pair with `.scrollbar-sleek-parent` on a hover-target ancestor if you want the thumb to fade in only on parent hover.
- **`.scrollbar-editor`** — slightly heavier, used inside Monaco-adjacent surfaces.
- **`.worktree-sidebar-scrollbar`** — no reserved gutter: paired with `overflow-y-auto`, the scrollbar (and its width) exists only while content actually overflows, so a short list stays flush with the fixed header controls and classic-scrollbar Windows shows no arrow buttons on empty lists. The thumb stays invisible until the parent (`.scrollbar-sleek-parent`) is hovered. Used only in the worktree sidebar.

Apply one of these to overflow containers; don't write a fourth style.

## UX rules

These are the rules a contributor will most often get wrong if they're working in isolation. They apply to every UI change.

**UI copy must not overclaim.** Never imply the app has taken an action, made a decision, or observed a fact unless the code has real state or result data to support it. Use neutral process language while work is pending, and reserve result verbs like "skipped", "protected", "found", "verified", or "deleted" for actual results.

### Screen UX review rubric

Use this rubric when reviewing any Orca IDE screen, screenshot, or prototype. A good review should name the highest-impact friction first, then give concrete changes the implementer can make.

#### Review output format

1. **Top fixes:** the 3 changes that would most improve the screen.
2. **Friction notes:** specific clutter, alignment, copy, focus, or flow issues, with the affected UI element named.
3. **Suggested changes:** exact changes to layout, hierarchy, controls, copy, empty/error states, and disclosure.
4. **Keyboard and speed check:** whether the primary workflow can be completed in 1-2 actions where appropriate, with good default focus and Enter/Esc behavior.
5. **Follow-up links or states:** missing external links, acquisition actions, or persistent errors the user needs to recover.

#### What to judge

- **Progressive disclosure:** keep high-frequency actions visible and prominent. Move low-frequency actions out of the common pointer path into menus, overflow controls, detail drawers, or advanced sections. Do not make menus so long that the user has to scan unrelated actions; group or split them when they grow.
- **Action hierarchy:** the primary action must be obvious through placement, size, and `default` button styling. Put high-frequency actions at the top of menus and in the most reachable toolbar positions. Secondary and rare actions should not compete with the primary action.
- **Click count:** remove unnecessary intermediate steps. Common workflows should complete in 1-2 actions when the app already has enough information to proceed.
- **Default focus:** dialogs, popovers, and command surfaces should focus the field or primary action the user is most likely to use. If Enter submits, focus must land where Enter triggers the intended primary action. Esc should back out without adding visual noise to Cancel/Dismiss.
- **Keyboard navigation:** prefer searchable command surfaces for long option lists. Add search fields when users need to find repositories, branches, worktrees, agents, commands, settings, files, or providers from a list.
- **Shortcut labels:** show shortcut chips only for shortcuts that are actually implemented and useful at that location. Labels must match the platform binding. If a shortcut strategy is undecided, do not expose a placeholder label in product UI.
- **Alignment:** rows and columns must line up to a visible grid. Left-align text and labels for scanability; right-align numbers, counts, shortcuts, and trailing metadata when comparison matters; center-align only compact icon controls, empty states, and table cells where symmetry is the clearest read.
- **Copy quality:** displayed text must be typo-free, concise, and specific. Prefer direct verbs and concrete nouns. Remove filler like "please", "simply", "just", "you can", and generic success language that is not backed by state.
- **Dialogs and overlays:** choose a dialog size that matches the amount of input. Short confirmations stay compact; forms with multi-line text, path pickers, provider setup, or review content need a larger dialog or sheet. Floating surfaces must use the documented shadow/elevation and background treatment so they read as above the page.
- **Empty and error states:** when data is missing, show a direct action to acquire or configure that data. Use toasts for transient failures or confirmations; persist errors inline when the user needs to read, retry, copy, or act on the message.
- **External links:** add direct links when the user may need provider docs, token settings, billing/setup pages, Git provider resources, or troubleshooting context. Put links near the relevant empty state, error, helper text, or setup step instead of burying them in a generic menu.
- **Affordance:** users should be able to discover available features without intrusive education. Use familiar icons, visible hover/focus states, clear labels where needed, and tooltips for icon-only controls. Prefer simple lucide icons already used nearby over obscure alternatives.
- **Layout density:** avoid jamming controls together. Preserve breathing room around the primary workflow, reduce competing buttons, and keep toolbar groups visually distinct. Dense screens are acceptable only when grouping, alignment, and hierarchy make scanning faster.
- **Cards and containers:** cards must be visually distinct from their parent surface through the existing `card`/`border` treatment. Avoid nesting cards inside cards. If a section is not a repeated item, modal, or framed tool, consider an unframed layout or full-width band instead.
- **Side-by-side layouts:** default to row-by-row layouts for complex workflows because they are easier to align and scan. Use side-by-side layouts only when space is constrained or comparison is the point, then polish column widths, baselines, and wrapping states carefully.
- **Animation:** use subtle animation to soften expanding/collapsing content and prevent jumpy layout changes. Animation should clarify continuity, not decorate. Respect reduced-motion settings.
- **SSH and latency:** assume actions may run remotely. Disable submit controls immediately, delay visible loading feedback when appropriate, and keep focus stable while remote data arrives.

### 1. Match in-flight feedback to perceived duration

The right question isn't _"should this control change while it's working?"_ — it's _"how long does the action take, and what does the user need to know during that time?"_

| Duration           | Feedback                                      |
| ------------------ | --------------------------------------------- |
| 0–100 ms           | None. Anything visible reads as a glitch.     |
| 100 ms–1 s         | Disabled state only.                          |
| 1 s–3 s            | Disabled + spinner or label swap.             |
| 3 s+ or multi-step | Stage labels, progress, optional reassurance. |

Two corollaries:

- **Pre-reserve any space you'll later occupy.** If a control may swap to a longer label or grow an icon, fix its footprint up front (use `width`, not `min-width`). A control that resizes mid-action looks broken even when the action succeeded.
- **Don't pick worst-case feedback for everyone.** If the action is fast locally and slow remotely (SSH), defer the visible loading state by ~200ms. Local users see nothing; remote users get appropriate feedback. Bind the _disabled_ state immediately (so double-clicks don't double-submit) and the _visible_ state on a timer.

### 2. Look for sibling components before designing in isolation

If your component has a sibling — same domain, overlapping behavior, often visible at adjacent moments in the same flow — the two should read as one design. Same icons, same shortcut conventions, same submit semantics. A user moving between them shouldn't perceive a seam.

This is _not_ "match every existing pattern." Some repo patterns are debt and copying them spreads the debt. The narrower claim is about _adjacent_ components. Diverging from a sibling needs a reason: either the sibling is wrong (fix both) or the new component has a real difference in role (commit to it).

When there's no sibling, match the surrounding chrome — button sizes, icon weights, copy tone — and don't manufacture a sibling from a screen the user will never correlate with this one.

### 3. Don't overload the back-out path

`destructive` is for actions that lose data or can't be undone. **Cancel, Dismiss, Close, and Discard are not destructive** — they back the user out of an in-progress action and should stay quiet (default ghost button, no color, no keyboard chip, no animated affordance). Save the visual weight for the affirmative action so the two don't compete. Keyboard handlers can still honor Esc; the visible decoration is what stays minimal.

## Cross-platform

Orca runs on macOS, Linux, and Windows. Every UI change must hold up on all three, in both light and dark mode.

- **Modifier keys:** Never hardcode `e.metaKey`. Use `navigator.userAgent.includes('Mac')` to choose `metaKey` on Mac and `ctrlKey` on Linux/Windows. Electron menu accelerators should use `CmdOrCtrl`.
- **Shortcut labels:** Display `⌘` / `⇧` on Mac; display `Ctrl+` / `Shift+` on other platforms. The label must reflect the actual binding for that platform.
- **Window chrome:** macOS shows traffic lights; the titlebar reserves an 80px gutter (`titlebar-traffic-light-pad`) so they don't overlap content. Don't put hit targets in that band on Mac.
- **SSH:** Many users run Orca on a remote machine. Loading states, focus management, and animations must hold up under 50–200 ms of extra latency. Test under simulated latency (or actual SSH) — local-only verification isn't enough. See _UX rules → 1_.

## When this guide is silent

If you have a UI question this doc doesn't answer:

1. Look at adjacent code in `src/renderer/src/components/` for the closest sibling, and follow its lead.
2. Check `src/renderer/src/components/ui/` for a primitive that already encodes the pattern.
3. If it's a token question, `main.css` is canonical — use what's there, or add a new one in both light and dark.
4. If none of those resolve it, ask the user before inventing.
