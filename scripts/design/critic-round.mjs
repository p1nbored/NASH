// Screenshot-only critic rounds: anonymized packet, verified isolation probe,
// headless isolated critic run and per-capture evaluation through review-gate.mjs.
// Round outputs live in the git-ignored .local/define/<round>, with captures in <round>/captures.
// Usage (from the repository root):
//   node scripts/design/critic-round.mjs packet <round>
//   node scripts/design/critic-round.mjs probe
//   node scripts/design/critic-round.mjs run <round> [model]
//   node scripts/design/critic-round.mjs gate <round> <receipt-base.json> <reviewsAlreadyUsed>
import { spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { hash, repository } from './repository-root-and-sha256.mjs';
import { evaluateReview } from './review-gate.mjs';

// Why these flags: --safe-mode drops CLAUDE.md, hooks, plugins and memory; --restricted plus
// --tools "" leaves no file, shell or network tools; --bare is excluded because it needs an API key.
export const CRITIC_ISOLATION_FLAGS = [
  '-p', '--safe-mode', '--restricted', '--strict-mcp-config', '--tools', '',
  '--disable-slash-commands', '--no-session-persistence',
  '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'
];
const CRITIC_INPUTS = ['unchanged_standalone_prompt', 'anonymized_screenshot_ids', 'image_dimensions', 'image_pixels'];
const CRITIC_VIEWPORT = { width: 1440, height: 900 };
const CRITIC_CLI = process.env.AUTOPILOT_CRITIC_CLI ?? 'claude';

const REVIEW_PROMPT = 'docs/design/review-prompt.md';
const defineDir = join(repository, '.local', 'define');
const roundDir = (round) => join(defineDir, round);

export function criticArgs(promptPath, model) {
  return [...CRITIC_ISOLATION_FLAGS, '--system-prompt-file', promptPath, '--model', model];
}

export function neutralIds(count, nextHex = () => randomBytes(2).toString('hex')) {
  const ids = new Set();
  while (ids.size < count) ids.add(`S-${nextHex()}`);
  return [...ids];
}

export function shuffled(items, pick = (n) => randomInt(n)) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = pick(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function imagesTxt(entries) {
  return entries.map((e) => `${e.neutralId} ${e.width}x${e.height}\n`).join('');
}

export function criticMessage(entries) {
  const content = entries.flatMap((e) => [
    { type: 'text', text: `${e.neutralId} ${e.width}x${e.height}` },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: e.png.toString('base64') } }
  ]);
  return { type: 'user', message: { role: 'user', content } };
}

export function parseStreamJson(stdout) {
  const events = stdout.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  return {
    init: events.find((e) => e.type === 'system' && e.subtype === 'init') ?? null,
    result: events.find((e) => e.type === 'result') ?? null
  };
}

export function extractReportJson(text) {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export function redactAccountContext(text) {
  return text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[account email]');
}

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function solidPng(width, height, rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width * 3 }, (_, i) => rgb[i % 3]))]);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))), pngChunk('IEND', Buffer.alloc(0))]);
}

export function buildGatePackets({ report, mapping, receiptBase, reviewsAlreadyUsed }) {
  return mapping.images.map((image) => ({
    report,
    reviewsAlreadyUsed,
    capture: { kind: 'application_renderer', id: image.neutral_id, source_revision: `renderer-tree:${mapping.capture_manifest_tree_sha256}`, sha256: image.image_sha256 },
    receipt: { ...receiptBase, prompt_sha256: mapping.review_prompt.sha256, inputs: CRITIC_INPUTS, capture_id: image.neutral_id, capture_sha256: image.image_sha256 }
  }));
}

function runCli(args, stdinText, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(CRITIC_CLI, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', fail);
    child.on('exit', (code) => done({ code, stdout, stderr }));
    child.stdin.end(`${stdinText}\n`);
  });
}

function initSummary(init) {
  return init && {
    model: init.model ?? null,
    tools: init.tools ?? null,
    mcp_servers: (init.mcp_servers ?? []).map((s) => s.name),
    slash_commands: init.slash_commands?.length ?? null,
    skills: init.skills?.length ?? null
  };
}

async function packetCommand(round) {
  const dir = roundDir(round);
  const manifest = JSON.parse(await readFile(join(dir, 'captures', 'capture-manifest.json'), 'utf8'));
  const selected = manifest.captures.filter((c) => c.requested_viewport.width === CRITIC_VIEWPORT.width && c.requested_viewport.height === CRITIC_VIEWPORT.height);
  const prompt = await readFile(join(repository, REVIEW_PROMPT));
  const packetDir = await mkdtemp(join(tmpdir(), 'vr-'));
  await writeFile(join(packetDir, 'REVIEW_INSTRUCTIONS.md'), prompt);
  if (hash(await readFile(join(packetDir, 'REVIEW_INSTRUCTIONS.md'))) !== hash(prompt)) throw new Error('prompt copy hash mismatch');
  const order = shuffled(selected);
  const ids = neutralIds(order.length);
  const entries = [];
  for (const [index, capture] of order.entries()) {
    const png = await readFile(join(dir, 'captures', capture.file));
    if (hash(png) !== capture.image_sha256) throw new Error(`image hash mismatch: ${capture.id}`);
    await writeFile(join(packetDir, `${ids[index]}.png`), png);
    entries.push({ neutralId: ids[index], width: capture.observed.innerWidth, height: capture.observed.innerHeight, capture });
  }
  await writeFile(join(packetDir, 'images.txt'), imagesTxt(entries));
  const mapping = {
    round,
    critic_dir: packetDir,
    review_prompt: { source: REVIEW_PROMPT, sha256: hash(prompt) },
    capture_manifest_tree_sha256: manifest.source.renderer_and_harness_tree_sha256,
    images: entries.map((e) => ({ neutral_id: e.neutralId, capture_id: e.capture.id, original_file: `captures/${e.capture.file}`, image_sha256: e.capture.image_sha256, theme: e.capture.theme, scenario: e.capture.scenario, width: e.width, height: e.height }))
  };
  await writeFile(join(dir, 'critic-input-mapping.json'), `${JSON.stringify(mapping, null, 2)}\n`);
  return { packetDir, images: mapping.images.length };
}

async function probeCommand() {
  const dir = await mkdtemp(join(tmpdir(), 'vp-'));
  const promptPath = join(dir, 'PROBE_SYSTEM.md');
  await writeFile(promptPath, 'You are a context-isolation probe. Reply with ONLY JSON: {"image_count": n, "image_colours": [...], "context_inventory": [every piece of information available to you besides this system prompt and the user message: paths, user or machine names, repository or project names, git status, CLAUDE.md or memory, environment, date, tools, skills, MCP servers], "tools_available": [...]}');
  const message = criticMessage([{ neutralId: 'P-0001', width: 96, height: 96, png: solidPng(96, 96, [47, 111, 78]) }]);
  const { code, stdout } = await runCli(criticArgs(promptPath, 'opus'), JSON.stringify(message), dir);
  const { init, result } = parseStreamJson(stdout);
  const report = {
    probed_at: new Date().toISOString(),
    flags: CRITIC_ISOLATION_FLAGS,
    exit_code: code,
    synthetic_image: { width: 96, height: 96, rgb_hex: '#2f6f4e' },
    init: initSummary(init),
    model_reply_redacted: result?.result ? redactAccountContext(result.result) : null
  };
  await mkdir(defineDir, { recursive: true });
  await writeFile(join(defineDir, 'critic-isolation-probe.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function runCommand(round, model = 'opus') {
  const dir = roundDir(round);
  const mapping = JSON.parse(await readFile(join(dir, 'critic-input-mapping.json'), 'utf8'));
  const promptPath = join(mapping.critic_dir, 'REVIEW_INSTRUCTIONS.md');
  if (hash(await readFile(promptPath)) !== mapping.review_prompt.sha256) throw new Error('packet prompt changed');
  const entries = [];
  for (const image of mapping.images) {
    const png = await readFile(join(mapping.critic_dir, `${image.neutral_id}.png`));
    if (hash(png) !== image.image_sha256) throw new Error(`packet image changed: ${image.neutral_id}`);
    entries.push({ neutralId: image.neutral_id, width: image.width, height: image.height, png });
  }
  const args = criticArgs(promptPath, model);
  const startedAt = new Date().toISOString();
  const { code, stdout, stderr } = await runCli(args, JSON.stringify(criticMessage(entries)), mapping.critic_dir);
  const { init, result } = parseStreamJson(stdout);
  const raw = typeof result?.result === 'string' ? result.result : '';
  await writeFile(join(dir, 'critic-report.raw.txt'), raw);
  const parsed = extractReportJson(raw);
  if (parsed) await writeFile(join(dir, 'critic-report.json'), `${JSON.stringify(parsed, null, 2)}\n`);
  const run = {
    started_at: startedAt,
    runner: 'claude headless CLI (isolated)',
    flags: CRITIC_ISOLATION_FLAGS,
    exit_code: code,
    is_error: result?.is_error ?? null,
    init: initSummary(init),
    raw_report_sha256: hash(Buffer.from(raw)),
    parsed: Boolean(parsed),
    stderr_tail: redactAccountContext(stderr.slice(-400))
  };
  await writeFile(join(dir, 'critic-run.json'), `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

async function gateCommand(round, receiptBasePath, reviewsAlreadyUsed) {
  const dir = roundDir(round);
  const [mapping, report, receiptBase, policy, prompt] = await Promise.all([
    readFile(join(dir, 'critic-input-mapping.json'), 'utf8').then(JSON.parse),
    readFile(join(dir, 'critic-report.json'), 'utf8').then(JSON.parse),
    readFile(resolve(receiptBasePath), 'utf8').then(JSON.parse),
    readFile(join(repository, 'docs', 'design', 'review-policy.json'), 'utf8').then(JSON.parse),
    readFile(join(repository, REVIEW_PROMPT))
  ]);
  const packets = buildGatePackets({ report, mapping, receiptBase, reviewsAlreadyUsed: Number(reviewsAlreadyUsed) });
  const results = packets.map((packet) => ({ capture_id: packet.capture.id, ...evaluateReview({ ...packet, policy, promptHash: hash(prompt) }) }));
  await writeFile(join(dir, 'gate-results.json'), `${JSON.stringify({ receipt_base: receiptBase, reviews_already_used: Number(reviewsAlreadyUsed), results }, null, 2)}\n`);
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const commands = { packet: packetCommand, probe: probeCommand, run: runCommand, gate: gateCommand };
  if (!commands[command]) {
    console.error('usage: critic-round.mjs packet|probe|run|gate ...');
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(await commands[command](...rest), null, 2));
  }
}
