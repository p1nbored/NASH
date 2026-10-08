# NASH checkpoint

## 2026-10-08 最新差异清单：与 Orca 最新原生版本对照

本节仅列仍存在的 NASH 功能差异，已复用且行为与原生一致的内容不再列入。最新对照为 `stablyai/orca` 的 `61de2d8ec8598803c0177aea9613444f6d2ef79d`（2026-10-07），旧导入基线为 `995715b1`。已拉取并检出最新上游；本地对照副本 `C:\Programs\autopilot\.local\upstream\orca` 在同步前无未提交修改或删除，本轮保持原生对照用途。

**落地状态：**已把验证后的最新上游与 NASH 改动同步到 `C:\Programs\NASH\desktop`，并安装 NASH 自己的依赖、更新 CLI/relay/Windows 原生模块和桌面构建。此次实际同步 8,543 个源码路径；已有未提交修改和原始字体资源均先核对快照再保留。此次同步与后续清理一并纳入 NASH `main` 的提交。主 agent 可在“设置 → 任务路由”中选择 Claude Code 或 Codex。

**后续清理已完成：**用户明确批准删除并要求 commit/push。旧执行器结算拒绝检查、进程/工作树提示、关联进程记录表和未使用的帮助模块均已删除；没有增加兼容替代层。当前会话内验证与原生 worker 的报告权限/状态校验保留。旧开发任务库已在完整性检查后备份并重置（原有 0 个任务、2 条运行记录），新版首次启动会初始化当前结构。备份：`C:\Users\Administrator\AppData\Roaming\nash-backups\task-db-20261008043437`。CLI 账户和其他设置保留，Dot 需重新配对。

### 仍与 Orca 原生不同的功能（已去除一致项）

| 功能 | 仍保留的差异 | 本次处理 / 当前状态 |
|---|---|---|
| 独立产品与仓库 | NASH 名称、app ID、用户数据目录、CLI 名称、用户提供的图标；项目与问题追踪归 `p1nbored/NASH` | 保留；继续使用原生插件与 RPC 标识 |
| 发布与更新 | NASH release 来源；未配置可用的独立自动更新 feed | 保留；不使用 Orca 发布服务冒充 NASH 更新 |
| 界面与字体 | Paper 暖色主题、语义 token、简化界面、衬线/无衬线角色、随包 Noto CJK 字体和六语言文案 | 保留，同时合入最新原生聊天、编辑器和设置变化 |
| 主 agent | 每个运行有唯一主 agent，可选择 Claude Code 或 Codex；CLI、模型和推理强度按运行固定 | 已实现；新设置只影响新运行，实际启动复用原生 `agent.launch` |
| Clef 分类器 | TaskSpec、任务分类、分类服务与设置是 NASH 增加的 | 保留 |
| 任务路由 | 路由表、版本、模型与 effort 检查、执行前复核是 NASH 增加的 | 保留；账户和额度改为读取最新 Orca 原生服务 |
| 子任务入口 | NASH 管理的运行必须经分类与 task-start；原生 worker-start/dispatch 不能跳过该入口 | 保留这一链路约束；普通原生运行不套用它 |
| worker 间调用 | 原生 send/ask/reply/check 保留；NASH routed worker 新增分派交回主 agent | 保留分类与路由职责，不替换原生消息传输 |
| 上下文与任务参数 | TaskSpec 的预期输出、验收条件和约束进入原生 preamble；动态验证过的 model/effort 可透传 | 保留这一小层适配，不重建会话或上下文系统 |
| 任务权限 | NASH 每任务 read_only/workspace_write 上限及其持久化 | 保留到原生启动与 Codex structured；不修改全局权限。AGY --sandbox 仍不等于完整文件系统只读 |
| worktree 策略 | 写入 Git 任务使用 child worktree；只读任务和普通文件夹留在原位置 | 复用原生创建逻辑；不复制未提交修改 |
| 运行取消 | NASH 运行取消等待正在启动的 worker | 使用原生 stop/release；旧独立执行器、结果文件回退和重启恢复已删除 |
| 独立复核 | “独立复核”流程和验收规则是 NASH 新增 | 已改用 Orca one-shot CLI 参数、共享 runProcess 和 Codex home lock；one-shot 本身仍是 headless。并未把所有原生 worker 自动接管成独立复核 |
| 原 Coordinator | NASH 运行不会启用 Orca 的自主 Coordinator 规划循环 | 恢复原生 Coordinator 库和测试，但不接入 NASH 主链，不增加第二个规划 agent |
| Workbench | 请求、运行、任务、权限和复核视图属于 NASH | 保留；与 RSI 无关；任务视图直接打开原生会话或终端；已删除旧执行器转录视图 |
| Dot | 独立设置、授权、local intake、远程配对、MCP 契约和请求链路 | 仅接受当前 local ingress 3 / remote 4；旧协议、旧快照补齐和迁移已删除。Site 已私有发布同样的当前格式，删除交付语言字段 |
| Orca Account / Mobile | 产品入口隐藏，相关 Orca 云依赖停用 | 保留用户要求；不等于禁用 Claude/Codex 等 provider 账户，也不隐藏手机开发模拟器 |
| RSI | 本地有实验代码，后端未完成 | 入口继续隐藏，不构造实时数据 |
| 插件来源 | 原生 plugin manager 保留；Orca catalog 经兼容适配、默认关闭 | 保留独立来源策略，未删除原生插件机制 |
| 工件与分享技能 | 实现来源于 Orca；NASH 独立部署时云发布目的地不同或未接通 | 保留原生能力，不宣称 Orca 云分享服务在 NASH 已可用 |
| 全局状态 hooks | 现有 NASH 限制仅自动写 Claude Code 的状态 hooks，其他 CLI 不自动写用户全局 hooks | 这是仍存在的本地限制；不等于禁止启动其他 CLI。沿用现有选择，本轮未扩大全局配置写入范围 |
| AGY Windows 账户 | 本地增加 Windows Credential Manager 和私有文件权限适配 | 保留。最新上游仍显式拒绝 Windows 原生切换；真实双账户切换尚未实测 |
| Windows / WSL | NASH 保留 WSL 冷启动预算修复、开发服务 127.0.0.1 绑定及身份路径适配 | 保留有效本地修复，同时合入最新上游运行时改进 |
| 模型可用性 | NASH 路由要求真实 provider 列表及固定模型/effort | 保留；Gemini 4 家族排除已取消，不预填尚未发布的可用型号 |
| 引导清单 | 按 NASH 的入口与功能裁剪 | Claude Code 或 Codex 均可完成安装步骤；删除旧清单进度迁移、标记和弃用参数转接 |
| 工作流语言 | Dot → 主 agent → 任务流程 → 返回 Dot 的消息使用英文 | 删除 `deliverableLanguage` 和固定 `zh-Hans` 约束；工件语言由任务内容决定 |

### 当前验证与差异文件表

- 最终旧执行器删除后，Node、CLI、Web 类型检查、六语言目录和 RPC 生成目录检查通过；定向 native/report/decision/schema 测试和独立代码复核通过。 最后一次组合回归 **90 个文件 / 1,063 项全部通过**，真实进程拦截数为 0；最终 CLI/桌面构建与正式目录隔离启动通过。
- 桌面生产构建、CLI/relay 构建及 Windows x64 原生构建通过。正式 NASH 目录的隔离启动通过，窗口保持隐藏，欢迎界面及新的主 agent 设置说明已渲染。
- 主 agent/路由/原生任务回归 67 个文件、1,420 项通过；Dot 回归 81 个文件、1,600 项通过（1 个平台跳过）；后续清单 175 项、原生停止 15 项、任务语言与请求 128 项通过。这些批次有重叠，不累加为总数。最终组合回归初次通过 226 个文件；7 个套件发现旧夹具/期望未同步，修复后这 7 个套件的 99 项全部通过。正式目录启动检查也通过。
- 网站 145 项测试、类型检查、构建通过；[当前私有 Dot MCP Site](https://nash-dot-mcp.taojuguo.chatgpt.site) 已成功发布。源码提交 `6bb5cbf6fd384d06fc779c43e9376a128de17818`，版本 `appgver_3d12a2ee1c588191a9eb3a495fa78271`；remote 4 / ingress 3，manifest SHA-256 `4065156f3037753862e7eaa2ed075b30e39d8bc225e3fda4255690f1f2ea89af`。
- 未调用付费 provider，未做 AGY 真实双账户切换，未启动真实任务；完整继承测试套件和发布安装包不在已验证范围。独立更新源、云分享服务、RSI 后端仍未完成。

[完整文件级改动表（CSV）](nash-orca-change-table.csv) 已改为对照 Orca `61de2d8e`，仅列当前不同的文件：**2,926 个路径**，其中 desktop 2,723、NASH 根目录 203；新增 1,425、修改 1,497、删除 4。集合与 Git diff + NASH 根文件清单校验一致。功能分类是定位索引，不代表逐行人工审核。

相对最新 Orca 的四处删除是旧开发更新配置、两张被用户图标替代的 Orca 图标，以及已移除的旧清单进度迁移组件。原生对照副本没有本地删除或修改。上一轮删除了 138 个旧 NASH 执行器/转录/停止端口/清单适配文件，本轮继续删除剩余旧进程记录和提示模块；Dot 与 Workbench 旧协议/迁移文件也已清理，这些删除不能与“相对 Orca 的四处删除”混为一谈。

---

## 2026-10-08 上一轮记录：恢复原生执行与旧基线改动表

以下仅保留上一轮验证记录。上一轮基线为 `995715b1`，原文件表有 3,221 项；当前 CSV 已更新为上方最新基线，不再保留重复功能总表。

### 本轮验证与边界

本轮不调用真实付费 provider，不切换用户真实账户，不重启用户正在运行的应用。最终相关回归通过：106 个文件 / 1,339 项测试；另外 5 个启动接线测试文件 / 56 项通过，合计 111 个文件 / 1,395 项。Node、CLI、Web 类型检查、生产构建、84 个修改源码文件的质量门禁及 git diff --check 均通过。使用独立临时配置和 ORCA_BACKGROUND_LAUNCH=1 启动最终 Electron 构建，通过 CDP 确认 file:// 页面渲染为 NASH 欢迎界面（非空白）；测试实例随后已关闭。旧版应用需要正常退出重启才能加载新的主进程代码。独立 reviewer 已检查启动、权限持久化、结果、重试身份和取消链；审查发现的问题在本轮代码和回归测试中处理。

自动审批曾拒绝向静态目录补模型条目的方案，理由是可能错误宣称未验证模型可用。最终使用动态路由已验证的模型/effort，不添加这些静态条目。

---


Updated 2026-10-08 UTC. This supersedes the early October 6 pause. Resumed Claude session: d58be37e-3966-4113-abb6-6b3a457e2123. Plan: [UI and independence](nash-ui-ia-independence-plan-2026-10-06.md).

## Earlier delivery record（原生执行恢复前的历史记录）

Canonical source is C:\Programs\NASH, main branch, private remote https://github.com/p1nbored/NASH. The implementation was delivered through d9b50189; subsequent cleanup reduces test/document files and unnecessary diagnostic truncation.

- P0/P8: independent repository, desktop/ layout, and the user's Desktop/icon.png-derived app icon. Titlebar, welcome/onboarding and menus reuse that complete PNG with its colors.
- P1-P4: semantic design tokens, CJK font stacks, Dot/Task routing settings, concise Workbench/task views and onboarding from real signals. Orca Account/Mobile and unimplemented RSI remain hidden.
- P5: Windows Credential Manager adapter and native addon; USERPROFILE launch handling. A disposable nash-test credential passed write/read/replacement/cleanup; the actual agy login credential was not touched.
- P6: remote contract v4 permits workspace_write only within the desktop workspace maximum. Site version 5 is published owner-private; [deployment and rollback evidence](dot-remote-write-handover-2026-10-06.md#7-publication-verified-on-2026-10-08-utc).
- P7: zh 885, ja 887, ko 887, fr 887 and es 1,050 translations added. All 1,633 NASH-specific keys are present with matching placeholders in all five languages. This check originally proved key coverage only; the follow-up audit below also corrected copied English prose. Upstream translation gaps are outside this change.
- P9: official Orca catalog is opt-in. Disabled means no add/refresh of its source; cached entries remain readable.

## Earlier CLI scope（历史记录，已由顶部 D-041 表取代）

以下 Codex/AGY headless 描述仅记录旧任务执行路径。当前任务走 Orca 原生 worker；独立复核采用原生 one-shot 参数。旧执行器与旧历史兼容正在按本页首节清理。

Workbench controls local requests, runs, tasks, permissions, validation and transcripts. It is unrelated to RSI.

| CLI | NASH behavior |
|---|---|
| Claude Code | Primary, subagent, workflow and reviewer execution using the user's own login; no managed account switching |
| Codex | Headless codex exec with explicit model/effort/sandbox; --ignore-user-config and --ignore-rules exclude the user's config/MCP/rules |
| agy | Headless --print execution; fixed-target Windows credential adapter |
| Other catalogued CLIs | Manual terminal launch retained; no new managed executor or usage meter |

Existing terminal, worktree, editor, browser, diff, plugin service and GitHub/Linear implementations remain. Linear may require reconnecting in NASH's separate data directory. Live compatibility of every integration was not tested.

## Verification

- Affected desktop/config batch: 105 files, 1,434 passed tests and 4 skipped. Icon follow-up: 6 files, 60 tests passed.
- Remote contract: 303 tests passed with normal snapshot comparison. Site: 149 tests passed.
- Node/CLI/Web and Site type checks passed. Changed-code quality: zero findings across 323 source files.
- Localization checks passed. 36 fixture screenshots cover six languages, light/dark, Workbench/Dot/Task routing with no page-width overflow. Additional light/dark screenshots verify the corrected icon.
- Fixtures do not validate Electron/PTY/live-agent behavior; the harness's known terminal-size error remains.
- Independent review's Important credential-redaction finding was reproduced and fixed. Prefix-bearing environment names and escaped quoted values are covered. No Critical finding was reported; the review was sampled.
- Secret-pattern checks found no suspicious added values or tracked credential/environment files.

The earlier full-suite batches were not green: A had 36 failing files, B 211, C 51, wider than the previous 2,307-file baseline. They include Windows sockets, native cleanup and missing bundled tools in untouched areas. No claim is made that the complete inherited suite passes. Detailed prior-run evidence remains in commit d9b50189 and the task's temporary logs.

## Remaining live checks

The authenticated connector returned the v4 manifest hash and paired=true, online=false. Its workspace list was empty. Start a rebuilt NASH desktop, refresh the existing connector's tool catalog, and use a new conversation before testing a real accepted workspace-write request and a refused read-only-workspace write.

Real routed CLI/Clef tasks, two-account switching and release packaging remain unverified. No paid provider call or real task was started during this work.

## Cleanup decisions

Cleanup verification: 111 related tests, all three desktop type checks and the changed-code quality gate passed. This cleanup adds no files and removes nine resume-only files.

Tests stay with their existing feature suites. The translation-key JSON remains as test data; it preserves the complete 1,633-key check without a second coverage mechanism. Repeated process/delivery records have been folded into this checkpoint and the existing Dot handover.

Clipboard diagnostics are redacted once and are not arbitrarily truncated. The existing crash-report size limit remains. Permission checks, failed-routing-proposal cleanup, stale-draft invalidation and refresh coalescing address reproduced bugs and remain in place.

Deferred minor items: web-client/hidden-pane navigation edge cases, the existing IdentifierText duplicate-key warning and optional onboarding/Linux cleanup. No new worktree, runtime framework or global package-manager configuration was introduced.

## Requirement audit (2026-10-08 UTC)

This audit supersedes the earlier broad P0-P9 completion claim. Implementation, fixture rendering, local integration checks and live provider acceptance are separate evidence levels. Local cleanup and the following fixes are not yet committed or pushed.

| Requirement | Actual status and evidence | Remaining acceptance |
|---|---|---|
| I-01 Visual direction | D12 Paper tokens and shared controls implement the warm editorial shell. | The complete frontend brief's scenario matrix and qualifying independent blind review are not complete. Existing policy has zero live critic jobs; no new blind-review score is claimed. |
| I-02 Global design system | Fonts, type, spacing, color/state and 6/8/10 px principal radii have semantic tokens. This audit corrects serif/sans roles and bundles full CJK fonts. | Some inherited Orca components still contain arbitrary sizes; this is not a claim that every old component has been normalized. |
| I-03 Concise new surfaces | Dot/task settings use unframed groups; Workbench uses compact lists. Task choices have human labels; diagnostic IDs/hashes are behind Copy details. The ZCode notice no longer claims NASH installed its hooks. | The full application has not passed the brief's subtraction/visual acceptance matrix. |
| I-04 Localization | All 1,633 tracked NASH keys have matching placeholders. This audit fixes 91 localized values (38 ko, 48 es, 3 ja, 1 zh, 1 fr), including copied English prose; one English source message is corrected. | Native-speaker editorial review and every inherited Orca screen are not covered by this assertion. |
| I-05 Icon | Main-window icon assets, titlebar, landing, onboarding and menus use the user-provided N image. | Installer/taskbar appearance in a release package is not newly verified. |
| I-06 Dot category | Dedicated Settings → Dot includes local ingress, allowed workspaces and remote pairing. | Implemented and covered by settings tests. |
| I-07 Orca Account/Mobile | Build flag hides Orca Cloud account and mobile-companion settings, navigation and associated entry points while retaining compatible code. The browser phone emulator remains a development tool and is still visible. | Deliberately hidden, not deleted. |
| I-08 RSI | Left-navigation entries exist behind a disabled flag; old Workbench placeholders are removed. | Backend remains unavailable. No invented live RSI data. |
| I-09 Workbench | Right inspector for local requests, runs/tasks, permission prompts, validation decisions, follow-ups and stopping work. | Not an RSI feature. |
| I-10 Onboarding | Eight steps now include Claude Code, Clef, Dot and the first Workbench run, with existing integration/notification/setup/worktree steps retained. Signals come from detection and read-only state. | Detected/paired/configured does not establish a successful authenticated task. |
| I-11 Dot writes | Separate remote read-only cap was the cause. Desktop and deployed Site contract v4 now allow workspace_write, still capped by each workspace. Fresh connector status reports contract v4 and the expected manifest. | The paired desktop is offline at audit time; no accepted remote write plus refused read-only-workspace write has run end to end. |
| I-12 AGY Windows accounts | Credential Manager adapter replaces the blanket Windows refusal; USERPROFILE launch handling is implemented. Unit tests pass, and a disposable native credential was previously verified. | Two real account switches are unverified. Windows SSH file-storage mode and native Linux Secret Service remain unsupported. |
| I-13 CLI/harness status | The per-entry inventory below distinguishes catalog preservation, installation and managed execution. | Installed commands are not proof of a successful in-app provider task. |
| I-14 Orca capabilities | Terminal/worktree/editor/browser/diff/GitHub/Linear code remains. Real Electron startup, project/file tree and new-tab menu work after the IPv4 fix. | Full native PTY/editor/browser/diff lifecycle and live GitHub/Linear acceptance are not complete; Linear may need reconnecting to NASH's separate data. |
| I-15 Plugins | main/plugins and shared/plugins match imported upstream snapshot 8105599b. The catalog opt-in is an adapter around the existing service; plugin IPC/activation/consent remain. | No real third-party install/activation was newly exercised. Default catalog access is off; existing Orca profile plugins are not automatically migrated. |
| I-16 Independent repository | Canonical C:\Programs\NASH, main, origin https://github.com/p1nbored/NASH.git. Imported upstream history is recorded in 8105599b. | Current local follow-up edits have not been pushed. |
| I-17 Identity/data/releases | NASH app ID, URL scheme, data directories and CLI names are independent. Source/issue/release links target p1nbored/NASH. | updateFeed is intentionally null. Automatic update delivery and a release installer have not been verified. |

### CLI and harness inventory

The 45 catalog entries remain available for manual terminal launch. PATH inspection in this Windows session found only claude, codex and agy; Claude Agent Teams reuses claude. A missing PATH entry is not proof that a tool is absent from every WSL or remote host. No provider inference was invoked for this audit.

| Integration | Command | This host | NASH-managed task execution / limitation |
|---|---|---|---|
| Claude | `claude` | Command found; app run unverified | Primary/subagent/workflow/reviewer; own login; managed status hooks; no NASH Claude account switching |
| Claude Agent Teams | `claude (teams mode)` | Command found; app run unverified | Manual Teams launch retained; no separate managed Teams executor |
| OpenClaude | `openclaude` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Codex | `codex` | Command found; app run unverified | Direct codex exec with explicit model/effort/sandbox; --ignore-user-config and --ignore-rules |
| Grok | `grok` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| GitHub Copilot | `copilot` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| OpenCode 2 | `opencode2` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| OpenCode | `opencode` | Not found on this PATH; unverified | Manual launch and original account-switching code retained; no managed executor |
| MiMo Code | `mimo` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Ante | `ante` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Trae | `traecli` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Muse | `muse` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| DeepSeek Harness | `dsh-tui` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Qoder CLI | `qodercli` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Qoder CLI China | `qoderclicn` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| ZCode | `zcode` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Pi | `pi` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| OMP | `omp` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Prime Agent | `prime-agent` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Gemini | `gemini` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Antigravity | `agy` | Command found; app run unverified | Direct agy --print; exact provider-listed model (Gemini family ban removed by D-040); --sandbox is not a proven read-only boundary |
| Aider | `aider` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Goose | `goose` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Amp | `amp` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Kilocode | `kilo` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Kiro | `kiro-cli` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Charm | `crush` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Auggie | `auggie` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Autohand Code | `autohand` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Cline | `cline` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Codebuff | `codebuff` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Freebuff | `freebuff` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Command Code | `command-code` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Continue | `cn` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Cursor | `cursor-agent` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Droid | `droid` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Kimi | `kimi` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Mistral Vibe | `vibe` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Qwen Code | `qwen` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Rovo Dev | `rovo` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Hermes | `hermes` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Devin | `devin` | Not found on this PATH; unverified | Manual launch and original account-switching code retained; no managed executor |
| OpenClaw | `openclaw` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| CodeBuddy | `codebuddy` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |
| Jcode | `jcode` | Not found on this PATH; unverified | Manual launch retained; no managed executor or NASH status hooks |

The removed codex-plugin-cc harness is a separate, explicit D-016 architecture decision. It is not the Orca plugin mechanism; do not describe it as still supported. Custom CLIs/harnesses can be started manually through a terminal, but do not acquire managed scheduling, validation or status integration by doing so.

Managed execution is more constrained than a manual terminal: Codex ignores user config/MCP/profiles/rules for routed tasks; shared exec environments omit provider credential variables; the Claude reviewer also omits a custom CLAUDE_CONFIG_DIR and uses the normal default home. These policies are documented, not changed by this UI audit. Only Claude receives NASH-managed status hooks. Usage meters are scoped to Claude/Codex/agy; other catalog entries are not equivalent managed integrations.

### Follow-up verification

- Final font/localization batch: 11 files, 315 tests passed. Earlier requirement/compatibility batches: 21 files, 430 tests passed (overlapping suites; do not add the counts).
- Node, CLI and Web type checks passed. Production electron-vite build passed and emitted both font assets; its inherited large-chunk warning remains. Changed-code quality passed with zero findings across 16 source files; git diff --check passed.
- Chromium inspected the actual glyph providers for en/zh/ja/ko/es/fr: Latin main titles use Georgia; Chinese/Japanese/Korean main titles use bundled Noto Serif CJK, and CJK group headings use bundled Noto Sans CJK. Titles use the 20/28 px token; group headings use 15/22 px semibold sans. All normal controls remain sans; code/terminals/paths remain monospace.
- 44 real-renderer fixture screenshots cover Workbench, task settings and Dot in six languages and light/dark themes, plus Chinese/French task settings at 1100 and 1920 px. No page-width overflow or loading-only capture remained. The fixture's inherited terminal cols error remains; these screenshots do not prove native terminal operation.
- A hidden real Electron loaded production out/renderer/index.html from file:// with a fresh isolated profile. Chinese Settings rendered, and CDP reported Noto Serif CJK SC with isCustomFont=true for its title. This confirms the built local font path, not installer acceptance.
- New repository files in this audit are exactly two WOFF2 fonts and resources/licenses/NotoCJK-OFL.txt, authorized by the user. Fonts total 30,192,124 bytes (about 28.8 MiB). No runtime font downloader, new application dependency, extra report, retry loop or compatibility fallback was introduced.
- Font WOFF2 SHA-256: Sans `6f4914a40f848ab25ca1e0e1f74404e6f7e66c09643014876f7b3e4ecfaa8625`; Serif `d03fd286e267df2e293b5dbdb2643ad3af106c84b2ad091309a79e75fcddb196`.

## Orca invocation and context audit (D-040)

Comparison base: imported Orca snapshot 8105599b (upstream 995715b1). The requirement is one primary agent plus the retained classifier and routing table, with original Orca invocation and context transfer. Retaining source files and database tables does not prove a new call path uses them.

| Area | Current difference from Orca | Consequence |
|---|---|---|
| Native worker launch | worker/workers.ts adds assertAppRunUsesTaskStart; runs/dispatch-methods.ts adds the same app-run fence. | An app-owned run cannot use the otherwise preserved worker-start/dispatch path. This conflicts with D-040. |
| Original context delivery | orchestration/preamble and worker/deliver-worker-dispatch-preamble.ts plus worker-start-readiness-settlement.ts match the imported snapshot. | Native PTY/structured workers still have Orca's task preamble, coordinator/worker addresses, message verbs and native delivery. Reuse these; do not claim a new prompt is equivalent. |
| NASH Codex/agy calls | task-execution/codex-task-executor.ts and agy-task-executor.ts call added runCodexExec/runAgyExec runners. | App tasks use independent headless processes, not the original worker launch path. |
| NASH context | executor-task-prompt.ts creates a separate objective/outputs/criteria/constraints prompt; primary-session-prompt.ts directs the coordinator to five NASH task commands. | The native dispatch preamble and its interactive worker protocol are bypassed for these process attempts. |
| User CLI configuration | Codex adds --ignore-user-config and --ignore-rules. Shared exec environment uses an allowlist, which also drops the Claude reviewer's custom CLAUDE_CONFIG_DIR. | These calls differ from a user's normal CLI and original terminal-worker environment. This is a migration target, not a completed restoration. |
| Messaging and reports | send/ask/reply/check infrastructure remains. App-run guards additionally restrict task-update and worker-report settlement. | Shared transport is reused, but app-run completion semantics changed. Simply removing the startup fence would leave result handling inconsistent. |
| Run ownership | NASH adds primary-session ownership and task classification/route records over Orca run/task/dispatch tables. | Preserve one coordinator and the classifier/route decisions; do not delete historical state to restore invocation. |
| Coordinator loop | orchestration.run/runStop were replaced with retirement refusals; the original Coordinator loop was removed. | Distinguish this autonomous loop from native worker/context infrastructure. Reintroducing another planner is not required for one primary agent. |

No claim is made that the native execution migration is complete. The bounded correction needs to feed routing choices into native worker invocation and use the original result/mailbox lifecycle consistently; it must not remove the classifier/router or merely unblock a second simultaneous execution path.

The Gemini 4 family ban is removed from model pins, agy argv and availability labels. Exact models absent from the provider listing remain unavailable. No real Gemini task was started or future model added to the defaults.

The WSL registration probe now lets the existing environment resolver use the CLI command's 10-second budget; its elapsed time is subtracted before the command runs. No new retry loop, cache or source file was added. A simulated six-second cold probe failed before the change and passes afterward.

Verification for D-040 and the WSL fix: 44 routing/agy/WSL test files passed (938 tests, 4 skipped), plus 23 WSL installer unit tests (2 real-shell cases skipped). Node/CLI/Web type checks, production build and changed-code quality passed. A fresh hidden Electron instance called cli:getWslInstallStatus successfully in 6,002 ms, then 655 ms; both returned supported=true and state=not_installed. No WSL launcher was installed, removed or rewritten. The user's active app needs a restart to load this code. This audit added no repository files.
