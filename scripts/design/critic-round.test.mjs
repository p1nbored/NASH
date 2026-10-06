import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CRITIC_ISOLATION_FLAGS,
  buildGatePackets,
  criticArgs,
  criticMessage,
  extractReportJson,
  imagesTxt,
  neutralIds,
  parseStreamJson,
  redactAccountContext,
  shuffled,
  solidPng
} from './critic-round.mjs';
import { evaluateReview } from './review-gate.mjs';

const POLICY = {
  minimum_total: 85,
  minimum_criterion_fraction: 0.6,
  max_initial_reviews_per_family: 1,
  max_revision_rounds_per_family: 3,
  criteria_maximum: { hierarchy_layout: 25, typography: 20, color_readability: 20, density_task_focus: 15, restraint_coherence: 10, craft_consistency: 10 },
  required_isolation: { input_allowlist: ['unchanged_standalone_prompt', 'anonymized_screenshot_ids', 'image_dimensions', 'image_pixels'] }
};
const HASH = 'a'.repeat(64);

test('critic args isolate the session and never use API-key-only bare mode', () => {
  const args = criticArgs('C:/tmp/vr-1/REVIEW_INSTRUCTIONS.md', 'opus');
  for (const flag of ['--safe-mode', '--restricted', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) {
    assert.ok(args.includes(flag), flag);
  }
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--system-prompt-file') + 1], 'C:/tmp/vr-1/REVIEW_INSTRUCTIONS.md');
  assert.equal(args[args.indexOf('--model') + 1], 'opus');
  assert.ok(!args.includes('--bare'));
  assert.deepEqual(args.slice(0, CRITIC_ISOLATION_FLAGS.length), CRITIC_ISOLATION_FLAGS);
});

test('neutral ids are unique S-xxxx tokens that carry no theme or view words', () => {
  let counter = 0;
  const ids = neutralIds(4, () => ['1a2b', '1a2b', '3c4d', '5e6f', '7a8b'][counter++]);
  assert.deepEqual(ids, ['S-1a2b', 'S-3c4d', 'S-5e6f', 'S-7a8b']);
  for (const id of ids) assert.doesNotMatch(id, /light|dark|workspace|settings|baseline/i);
});

test('shuffled returns a permutation without mutating its input', () => {
  const input = ['a', 'b', 'c', 'd'];
  const output = shuffled(input, (n) => n - 1);
  assert.deepEqual(input, ['a', 'b', 'c', 'd']);
  assert.deepEqual([...output].sort(), input);
});

test('images.txt lists only neutral ids and dimensions', () => {
  const text = imagesTxt([{ neutralId: 'S-1a2b', width: 1440, height: 900 }, { neutralId: 'S-3c4d', width: 1440, height: 900 }]);
  assert.equal(text, 'S-1a2b 1440x900\nS-3c4d 1440x900\n');
});

test('critic message carries only id/dimension text and image pixels', () => {
  const message = criticMessage([{ neutralId: 'S-1a2b', width: 2, height: 3, png: Buffer.from('png') }]);
  assert.equal(message.type, 'user');
  assert.deepEqual(message.message.content, [
    { type: 'text', text: 'S-1a2b 2x3' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from('png').toString('base64') } }
  ]);
});

test('stream-json parsing finds the init and result events', () => {
  const stdout = [
    JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', tools: [] }),
    'not json',
    JSON.stringify({ type: 'result', result: '{"a":1}', is_error: false })
  ].join('\n');
  const { init, result } = parseStreamJson(stdout);
  assert.equal(init.model, 'claude-opus-5-5');
  assert.equal(result.result, '{"a":1}');
});

test('report JSON is extracted from a fenced reply without rewriting it', () => {
  assert.deepEqual(extractReportJson('```json\n{"review_integrity":"clean"}\n```'), { review_integrity: 'clean' });
  assert.deepEqual(extractReportJson('{"x":2}'), { x: 2 });
  assert.equal(extractReportJson('no json here'), null);
});

test('account context is redacted before it is stored', () => {
  const redacted = redactAccountContext('User email: someone@example.com, path C:\\Users\\Someone\\x');
  assert.doesNotMatch(redacted, /someone@example\.com/);
  assert.match(redacted, /\[account email\]/);
});

test('solid PNG has a valid signature and IHDR dimensions', () => {
  const png = solidPng(4, 3, [1, 2, 3]);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 4);
  assert.equal(png.readUInt32BE(20), 3);
});

test('gate packets bind each neutral image and stay blocked without a Clef route', () => {
  const report = {
    review_integrity: 'clean',
    screens: [{ screenshot_id: 'S-1a2b', scores: { hierarchy_layout: 25, typography: 20, color_readability: 20, density_task_focus: 15, restraint_coherence: 10, craft_consistency: 10 }, total: 100, strengths: ['s'], visible_limitations: ['l'] }],
    issues: [],
    subtract: [],
    unverifiable_from_images: ['u'],
    visual_readiness: 'ready_for_human_review',
    summary: 'ok'
  };
  const mapping = { review_prompt: { sha256: HASH }, capture_manifest_tree_sha256: 'b'.repeat(64), images: [{ neutral_id: 'S-1a2b', image_sha256: HASH }] };
  const receiptBase = {
    route_source: 'none',
    isolation: { inherited_task_context: false, repository_access: false, network_access: false, terminal_access: false, image_input_verified: true, enforcement_evidence: 'probe' }
  };
  const [packet] = buildGatePackets({ report, mapping, receiptBase, reviewsAlreadyUsed: 1 });
  assert.equal(packet.capture.id, 'S-1a2b');
  assert.equal(packet.capture.kind, 'application_renderer');
  assert.equal(packet.receipt.capture_sha256, HASH);
  const result = evaluateReview({ ...packet, policy: POLICY, promptHash: HASH });
  assert.deepEqual(result.failures, ['registered_clef_route_required']);
  assert.equal(result.functional_release_authorized, false);
});
