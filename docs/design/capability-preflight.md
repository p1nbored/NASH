# Design capability preflight

> **Historical note, 2026-10-05 (D-016).** `codex-plugin-cc` is removed from the architecture, and Codex work runs only through the official Codex CLI (`codex exec`). Every statement here about the official Codex plugin is historical evidence of what was installed on 2026-10-03, not an execution path. That covers:
>
> - the `claude plugin list` row and the plugin enablement paragraph in section 2;
> - the plugin path in the resolved-path block;
> - the `codex_plugin` job in section 3;
> - all of section 4;
> - the plugin repository link in section 7.
>
> "Clef-selected surface" and "legal tuple" wording is also superseded: Clef now classifies TaskSpecs, and the Routing Table selects target, model and effort. See [architecture.md](../architecture.md).

Observation date: 2026-10-03, using the client date in America/New_York.

Status: local read-only interface inspection complete; live design capabilities unverified. This report distinguishes an installed interface, a configured feature, an exposed tool, and a successful execution. They are different evidence levels.

The inspection made no model turns, Clef inference calls, image-generation calls, API fallback calls, installations, vendor modifications, or shared configuration changes. Credential contents were not inspected. No design score or asset-generation success is claimed.

## 1. Initial project state and routing readiness

At the initial repository inventory for this preflight, the repository root contained `.git`, `.gitignore`, the build/review briefs, and documentation. No application implementation, command gateway, task registry, Clef adapter/configuration, executor, or runnable `teamctl` was present. The historical progress and compatibility documents also described application capabilities as `not-started`.

Therefore the existing Clef-selected design execution path is a documented policy, not an executable integration. The tools exposed to this development chat are not evidence that the application's selected execution surface has those tools. A manually spawned collaboration agent is not an application-owned, Clef-routed critic or asset task.

Historical blockers remain evidence of unresolved configuration, rather than fresh authentication or quota observations:

- `docs/decision-log.md` P-04: Clef account/token reference, sharing boundary, and first live call were pending.
- `docs/upstream-compatibility.md` section 8 and `docs/progress.md` B-14 (both archived outside the repository on 2026-10-04): the previous Clef verification report was not reviewed after a permission rejection. This inspection did not reopen that report or work around the rejection.
- P-01: no approved agy model binding was established in the reviewed project records.
- P-08: a prior Codex quota restriction was recorded. This preflight did not test current quota and does not assert that the restriction still applies.

New automatic critic and asset dispatches must remain blocked until the authoritative gateway/registry, legal tuple selection, budget checks, and selected-surface capability evidence exist. Missing Clef must not trigger a rules router, a Claude substitute, a plugin fallback, or direct use of this chat's image tool. Local seed generation, code-based direction previews, passive inspection, and renderer capture preparation can continue.

## 2. Fresh installed inventory

The following commands completed without model inference:

| Command | Observed result |
|---|---|
| `Get-Command codex,claude,agy` | Found the three installed command paths listed below |
| `codex --version` | `codex-cli 0.160.0` |
| `codex exec --help` | Non-interactive exec, image attachments, explicit model/config, JSONL, schema output, sandbox, ephemeral mode, user-config suppression, resume/fork |
| `codex features list` | `image_generation` stable and enabled; `view_image` stable and enabled; `memories` stable and disabled in this observed configuration |
| `codex debug --help` | Local model-catalog and prompt-input diagnostics are available |
| `codex debug prompt-input --help` | Prompt-input diagnostic accepts `--image`; no diagnostic inference was performed |
| `codex debug models --help` | `--bundled` skips refresh |
| `codex debug models --bundled` | The bundled approved-name candidates have text/image input modalities and advertised effort levels |
| `claude --version` | `2.1.288 (Claude Code)` |
| `claude --help` | Restrictions, safe mode, explicit tools/settings/MCP controls, and non-persistent print sessions are available |
| `claude plugin list` | `codex@openai-codex` 1.0.6 is installed and enabled |
| `agy --version` | `1.2.14` |
| `agy --help` | Print mode, JSON/stream-JSON, explicit model, conversation-ID continuation, and sandbox flag |

agy commands ran with `AGY_CLI_DISABLE_AUTO_UPDATE=1` in the child shell only. No agy catalog refresh or model turn was requested.

The prior 2026-10-02 report listed Codex 0.159.2, Claude 2.1.287, and a disabled official Codex plugin. Those facts are superseded by the local observations above. Plugin enablement alone does not establish safe managed eligibility: the application registry, scoped operation manifest, classified dispatch guard, host correlation, and budget enforcement were absent at the initial inventory. This preflight did not change enablement or inspect active plugin hooks.

Resolved paths:

```text
Codex command shim:
%USERPROFILE%/AppData/Roaming/npm/codex.ps1

Codex native executable:
%USERPROFILE%/AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe

Claude native executable:
%USERPROFILE%/.local/bin/claude.exe

agy native executable:
%USERPROFILE%/AppData/Local/agy/bin/agy.exe

Official Codex plugin:
%USERPROFILE%/.claude/plugins/cache/openai-codex/codex/1.0.6
```

The installed npm package metadata identifies `@openai/codex` 0.160.0, Apache-2.0, with entry point `bin/codex.js`. Executables were hashed with `Get-FileHash -Algorithm SHA256`; agy signature status was checked with `Get-AuthenticodeSignature`.

| Evidence file | SHA-256 |
|---|---|
| Codex native executable above | `FDDA5FA3CF3FB3D000B876720742857676293E4315E4B045FAE6F8BD7E866D1D` |
| Claude native executable above | `84304F7D4B0CD0EBCBE8318695A260151B48991A6659C3366FDD5DA290C0AB91` |
| agy native executable above | `07F7ED55654B7066886C7390D3F5E245DBE4EDE425C005909342CFC90333F2F8` |
| Installed imagegen skill below | `706D4D96E1D5C9E6023FE3CCABBA1BB34B364024D344FD25B8515EC7D28FE3C4` |

agy Authenticode status was Valid. No claim is made about current upstream binary equivalence for the plugin: its local manifest reports 1.0.6, but this preflight did not repeat the historical full upstream blob comparison.

## 3. Image input versus image generation

### Image input

`codex exec --help` explicitly exposes `-i, --image <FILE>...` for images attached to the initial prompt. The bundled catalog for both `gpt-6-astra` and `gpt-6.1-sol` lists `input_modalities: [text, image]`.

This verifies the installed attachment interface and catalog declaration. It does not prove that a live selected model receives or interprets the supplied pixels, that screenshot-only isolation is enforced, or that any rendered screen has been reviewed. The catalog query returned no `supports_image_generation` value for these candidates; no generation claim is derived from that missing field.

The same catalog advertises `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. Its ultra description refers to automatic task delegation. Live effort acceptance and compliance with the project's delegation constraints remain unverified. No shared effort configuration was changed.

### Image generation

The installed skill was read completely:

```text
%USERPROFILE%/.codex/skills/.system/imagegen/SKILL.md
```

Its preferred path is the built-in image-generation tool. The API-key CLI fallback requires explicit user selection; it is not a remedy to activate silently. No fallback script or SDK client was invoked.

The current development chat exposes `image_gen__imagegen`, and the installed CLI advertises `image_generation` as an enabled stable feature. Both are preflight evidence only. Neither demonstrates a generation result through a Clef-selected `codex_exec` or scoped `codex_plugin` job. There is no generated raster artifact, image-generation receipt, output hash, or integrated asset from this inspection.

Official [feature guidance](https://learn.chatgpt.com/docs/enterprise/govcloud-configuration) confirms that enabling the feature still depends on client, model, and provider support. The [official imagegen sample](https://raw.githubusercontent.com/openai/codex/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md), accessed 2026-10-03, agrees with the installed built-in/default and explicit-fallback boundary. Main-branch instructions are reference evidence, not an installed-version pin.

Raster asset task status: `blocked_pending_route_budget_and_selected_surface_verification`. A later generated bitmap must be validated by actual format/dimensions, source/output hashes, the observed generation tool, English art brief, task/route receipt, local placement, and in-context acceptance. A CSS/SVG neutral state must remain labeled as a deterministic placeholder, never generated art.

## 4. Official plugin limitations found in installed code

> Historical (D-016): the plugin is no longer part of the architecture. Kept as evidence only.

Local source inspection found:

| Evidence location | Observed limitation |
|---|---|
| `scripts/lib/codex.mjs:86-87` | `buildTurnInput(prompt)` constructs only a text input item |
| `scripts/lib/codex.mjs:1138` | `turn/start` uses that text-only helper |
| `scripts/codex-companion.mjs:71` | Allowed efforts are `none`, `minimal`, `low`, `medium`, `high`, and `xhigh` |
| `scripts/lib/codex.mjs:63-83` | Thread start/resume parameters include cwd, model, approval policy and sandbox; start defaults to ephemeral |
| `agents/codex-rescue.md:5,22` | The forwarder has Bash access and invokes the companion script |

No inspected plugin operation provides a first-class screenshot attachment or an enforced image-only reviewer boundary. Text containing an image path is not equivalent to image input. A worker reading that path with tools would require independent access-control verification and is not automatically screenshot-only.

Fresh plugin threads and read-only defaults do not prove clean context or filesystem isolation. The plugin's host-mediated workflow is also subject to its narrower approved project scope. Generic rescue must not make critic or image-generation work plugin-eligible by default.

## 5. Screenshot-only critic integrity

Status: `blocked_pending_isolation_image_input_and_route_verification`.

The fixed prompt is `docs/design/review-prompt.md`. It was inspected as an implementer. No critic was executed, and no builder agent has been mislabeled as a blind critic.

Current collaboration agents share workspace and tool availability. Suppressing inherited conversation with `fork_turns=none` does not establish removal of repository, terminal, or network access. The host offers no inspected per-agent image-only mount or tool allowlist. A separate agent under those conditions cannot satisfy the blind-review requirement.

Codex `--ignore-user-config`, `--ephemeral`, and a new thread are useful controls, but do not alone prove absence of project instructions, skills, memory, repository access, terminal tools, or network access. Read-only sandboxing is a write restriction, not an image-only read boundary.

Claude 2.1.288 help advertises `--safe-mode`, `--restricted`, `--tools`, `--strict-mcp-config`, `--setting-sources`, and `--no-session-persistence`. These suggest a possible restricted fresh-worker path, but this preflight did not verify their composition, multimodal input schema, or actual model-visible context. `--bare` also suppresses auto-discovery and memory, but its documented authentication path requires an API key or apiKeyHelper rather than OAuth/keychain. It must not silently replace the authorized subscription surface.

A critic admission probe must verify all of the following before reviewing:

1. A genuinely fresh session with no parent transcript, previous score, ranking, builder rationale, code, or build briefs.
2. The unchanged fixed prompt plus anonymized renderer images; only neutral image IDs/dimensions accompany them.
3. Explicit exclusion of repository instructions, Skills, memories, host-context transfer and unrelated workspace content.
4. Enforced absence of repo/network/terminal access and write/approval/release authority; prompt wording is insufficient.
5. Actual received image input and image-reading support on the selected model/surface, not just an attachment flag.
6. Registered task, real Clef route, profile/surface/version records, budget reservation, and input/output hashes outside critic context.

No evidence establishes a stronger critic than the builder. Record that limitation rather than inferring superiority from a model name. A compromised or insufficient-input review cannot satisfy the visual gate, regardless of score.

## 6. Resumption steps

1. Preserve prior research and reconcile the active ownership/implementation plan with the updated Orca briefs. Establish one task/command authority and fail-closed route state before managed design execution.
2. Continue local Discover work: private OS-random seed, documented mapping, three comparable labeled prototypes, common Workspace/Improvement scenarios, capture manifests, and provisional tokens. Do not declare final tokens frozen before the applicable review is complete.
3. Register pending critic and Codex asset tasks using the shared evidence pattern. Record unavailable capabilities precisely; do not create invisible auxiliary model calls.
4. Configure the authorized Clef dependency through secret references and a documented sharing boundary. Perform a separately authorized minimal live verification, validate the legal tuple and observed response identity, and retain its receipt. Do not read the historically rejected report through another route.
5. Implement and test the selected official execution adapter, supervisor ownership, explicit thread/conversation identities, stream bounds, cancellation/recovery, and provider budget aggregation. Use clearly labeled fakes for offline checks.
6. Create a restricted image-only critic environment and run the admission probe above. Local help/catalog diagnostics can precede paid verification; they must not be presented as successful live review.
7. Once asset plan/resource authorization and a real route exist, verify the actual built-in generation tool in that selected Codex surface. Stop the asset task honestly on unavailable tool/authentication/quota; continue independent UI work. No API fallback or invented image command.
8. Only after these capabilities pass, run the unchanged screenshot critic on actual renderer captures under the fixed visual threshold and revision caps. Keep untouched reports, failed outcomes, capture hashes and routing receipts. Run functional, accessibility, security, lifecycle and performance checks independently.

## 7. Evidence limitations

CLI/help/hash results were observed through the development tool outputs and summarized here; this file is not a live execution receipt. No real renderer captures, clean-context critic report, generated raster family, application route, or release evidence was produced by this preflight. Re-run relevant local checks when executable/plugin versions or configuration change, and bind future visual evidence to the actual code/assets revision.

Current primary references checked on 2026-10-03 include [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [the official Codex plugin repository](https://github.com/openai/codex-plugin-cc), and the generation sources linked above. Official documentation supports interface planning; fresh installed help and later selected-surface receipts remain necessary for acceptance.

## 8. Addendum, 2026-10-04: candidate isolated critic surface (Claude-owned frontend track)

Local help only; no model turn was run. `claude --version` now reports `2.1.289 (Claude Code)`, superseding the 2.1.288 observation above.

The installed help documents controls that could compose an image-only critic without inheriting this project:

| Control | Documented effect (installed help text) | Role in an isolated critic |
|---|---|---|
| `--tools ""` | Disables all built-in tools | No file, shell or network tool reaches the model |
| `--safe-mode` | Starts with CLAUDE.md, skills, plugins, hooks, MCP servers, custom agents and similar customizations disabled; auth and model selection work normally | Keeps the user subscription path, unlike `--bare` |
| `--restricted` with `--strict-mcp-config` | Ignores user/project/local settings files and MCP servers | Removes inherited settings and servers |
| `--system-prompt-file` | Replaces the default system prompt | The unchanged fixed critic prompt becomes the only instruction text |
| `--input-format stream-json` | Streaming JSON input in print mode | Lets images arrive as content blocks instead of file paths a tool would read |
| `--no-session-persistence`, `--disable-slash-commands` | No saved session; no skills | No resumable or skill-loaded context |
| Working directory | Any directory | An empty temporary directory outside the repository |

`--bare` is excluded because its documented authentication is an API key or `apiKeyHelper` only, which would be an undeclared API path.

None of this is verified. Before any review counts, an admission probe must record the session's actual tool inventory and loaded configuration from the stream's init event, confirm with a synthetic sentinel that no repository, CLAUDE.md, memory or prior-conversation text is visible, and confirm that a synthetic test image is actually read. That probe is itself a live model turn. The current policy authorizes zero live critic jobs, and no Clef route exists for it. Status therefore stays `blocked_pending_isolation_image_input_and_route_verification`. A fresh session on the builder's own model family is not evidence of a stronger or unbiased critic, and that limitation must be disclosed with any result.
