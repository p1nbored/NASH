import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const SKILL_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['skills', 'installed'],
    summary: 'List installed skill selectors',
    usage: 'nash skills installed [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Lists discovery IDs and names without reading skill contents into the CLI.',
      'Package metadata is validated when the selected skills are shared.',
      'Use an exact ID or an unambiguous name with `nash skills share --skill <selector>`.'
    ]
  },
  {
    path: ['skills', 'share'],
    summary: 'Publish explicitly selected installed skills behind one unlisted link',
    usage:
      'nash skills share --skill <selector> [--skill <selector> ...] --bundle-name <name> ' +
      '[--release-notes <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'skill', 'bundle-name', 'release-notes'],
    notes: [
      'Requires the default-off permission in Settings → Share Skills.',
      'The bundle name may be human-readable; Orca converts it to a portable lowercase package name.',
      'Selectors are exact discovery IDs or unambiguous names from `nash skills installed`.',
      'Only discovered skill directories can be selected; arbitrary paths and --all are not supported.',
      'The resulting link is unlisted. Anyone with it can inspect and install the bundle.'
    ],
    examples: [
      'nash skills share --skill frontend --bundle-name "Frontend Skills"',
      'nash skills share --skill frontend --skill testing --bundle-name "Team Toolkit" --json'
    ]
  },
  {
    path: ['skills', 'list'],
    summary: 'List version-matched skill guides bundled with this Orca CLI',
    usage: 'nash skills list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Reads bundled guide metadata locally without contacting the NASH runtime.',
      'With --json, prints a topics array of canonical names and one-line descriptions.',
      'Use `nash skills get <name>` for the compact guide, `--full` for its full reference package, or `nash skills install` to install skills.'
    ]
  },
  {
    path: ['skills', 'get'],
    aliases: [['skills', 'show']],
    summary: 'Print a version-matched skill guide as Markdown',
    usage: 'nash skills get <topic> [--full | --reference <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'topic', 'full', 'reference', 'references'],
    positionalArgs: ['topic'],
    notes: [
      'Reads bundled guide content locally without contacting the NASH runtime.',
      'Prints the compact guide by default. Use --full to print the full guide with bundled references when provided.',
      'Use --reference <name> to print one bundled reference alone, which is what an action gate in the compact guide needs; --references lists the available names.',
      'A reference name may be given bare (recovery-and-cleanup) or as the guide spells it (references/recovery-and-cleanup.md).',
      'Use --json for a deterministic object containing canonical topic metadata and content.'
    ],
    examples: [
      'nash skills get orca-cli',
      'nash skills get orchestration --full',
      'nash skills get orchestration --references',
      'nash skills get orchestration --reference recovery-and-cleanup'
    ]
  },
  {
    path: ['skills', 'install'],
    summary: 'Install bundled NASH skills via the community skills CLI',
    usage:
      'nash skills install [--skill <name>]... [--all] [--agent <name>[,<name>]] ' +
      '[--local] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'skill', 'all', 'agent', 'local', 'dry-run'],
    notes: [
      'Reads the bundled skill registry locally without contacting the NASH runtime.',
      'Resolves to the same `npx skills@<pinned> add <repo>/tree/<commit> --skill <name> ...` ' +
        'command used by Orca Settings, pinned to the commit this NASH build was made from, ' +
        'plus the non-interactive flags an unattended host needs (`npx --yes` and `-y`), ' +
        'then runs it and forwards its output and exit code.',
      'Installs globally (all projects, adds --global) by default. Use --local to install ' +
        'into the current project instead.',
      'Targets the coding agents Orca detects on this host, plus the shared ' +
        '.agents/skills directory. Without an explicit target the skills CLI installs ' +
        'into every agent it knows about, which litters a host with config ' +
        'directories for agents it does not have.',
      'Use --agent <name>[,<name>...] to choose targets yourself, or --agent universal ' +
        'for the shared directory alone. Required when Orca detects no agent.',
      'Use --dry-run to print the resolved command without running it.',
      'With --json, the skill listing and --dry-run emit JSON; a real install streams ' +
        "npx's own non-JSON output live and rejects --json.",
      'Omit --skill and --all to list installable skill names.',
      'Intended for headless hosts (SSH, containers, CI) with no desktop Settings UI to copy the install command from.'
    ],
    examples: [
      'nash skills install',
      'nash skills install --skill orca-cli --skill orchestration',
      'nash skills install --skill orca-cli --local',
      'nash skills install --skill orca-cli --agent claude-code,codex',
      'nash skills install --all --dry-run'
    ]
  },
  {
    path: ['skills', 'update'],
    summary: 'Update NASH skills to the version this NASH build ships',
    usage:
      'nash skills update [--skill <name>]... [--all] [--agent <name>[,<name>]] ' +
      '[--local] [--dry-run] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'skill', 'all', 'agent', 'local', 'dry-run'],
    notes: [
      'Reads the bundled skill registry locally without contacting the NASH runtime.',
      'Runs the same pinned `npx skills add` command as `nash skills install`, which ' +
        'replaces each selected skill with the copy this NASH build ships.',
      'Updates the global install (all projects, adds --global) by default. Use --local to ' +
        'update the current project instead.',
      'Targets the same agents as `nash skills install`, or only the shared ' +
        '.agents/skills directory when none is detected; use --agent to choose them yourself.',
      'Use --dry-run to print the resolved command without running it.',
      'With --json, the skill listing and --dry-run emit JSON; a real update streams ' +
        "npx's own non-JSON output live and rejects --json.",
      'Omit --skill and --all to list updatable skill names.',
      'Intended for headless hosts (SSH, containers, CI) with no desktop Settings UI to copy the update command from.'
    ],
    examples: [
      'nash skills update',
      'nash skills update --skill orca-cli --skill orchestration',
      'nash skills update --skill orca-cli --local',
      'nash skills update --all --dry-run'
    ]
  }
]
