// FIXTURE_ONLY: no model execution, credentials, routing fallback or application verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluateReview } from './review-gate.mjs';

const policy = JSON.parse(await readFile(new URL('../../docs/design/review-policy.json', import.meta.url), 'utf8'));
function fixturePacket() {
  return {
    policy: structuredClone(policy), promptHash: '1'.repeat(64),
    capture: { id: 'S01', kind: 'application_renderer', source_revision: 'commit-fixture', sha256: '2'.repeat(64) },
    receipt: {
      task_id: 'fixture-task', route_source: 'clef', route_decision_id: 'fixture-route', reported_surface: 'codex_exec',
      prompt_sha256: '1'.repeat(64), capture_id: 'S01', capture_sha256: '2'.repeat(64),
      inputs: ['unchanged_standalone_prompt', 'anonymized_screenshot_ids', 'image_dimensions', 'image_pixels'],
      isolation: { inherited_task_context: false, repository_access: false, network_access: false, terminal_access: false, image_input_verified: true, enforcement_evidence: 'FIXTURE_ONLY attestation, not a real runtime receipt' },
    },
    report: { review_integrity: 'clean', screens: [{ screenshot_id: 'S01', scores: { hierarchy_layout: 23, typography: 18, color_readability: 18, density_task_focus: 13, restraint_coherence: 9, craft_consistency: 9 }, total: 90, strengths: [], visible_limitations: [] }], issues: [], subtract: [], unverifiable_from_images: [], visual_readiness: 'ready_for_human_review', summary: 'FIXTURE_ONLY policy test.' },
  };
}

test('visual admission never grants functional release authority', () => {
  assert.deepEqual(evaluateReview(fixturePacket()), { status: 'metadata_policy_passed', failures: [], operational_admission: 'blocked_runtime_attestation_unimplemented', functional_release_authorized: false });
});

for (const [name, mutate, expected] of [
  ['prototype cannot impersonate app renderer', p => p.capture.kind = 'discover_prototype', 'actual_application_capture_required'],
  ['changed standing rubric', p => p.receipt.prompt_sha256 = 'mutated', 'fixed_prompt_mismatch'],
  ['missing Clef', p => p.receipt.route_source = 'manual', 'registered_clef_route_required'],
  ['inherited builder context', p => p.receipt.isolation.inherited_task_context = true, 'isolation_or_image_support_unverified'],
  ['repo access', p => p.receipt.isolation.repository_access = true, 'isolation_or_image_support_unverified'],
  ['missing vision evidence', p => p.receipt.isolation.image_input_verified = false, 'isolation_or_image_support_unverified'],
  ['extra builder explanation', p => p.receipt.inputs.push('builder_rationale'), 'disallowed_critic_context'],
  ['missing image input', p => p.receipt.inputs = ['unchanged_standalone_prompt'], 'disallowed_critic_context'],
  ['missing issues array', p => delete p.report.issues, 'incomplete_review_report'],
  ['invalid evidence hash', p => p.capture.sha256 = 'not-a-hash', 'invalid_evidence_hash'],
  ['mismatched image', p => p.receipt.capture_sha256 = 'other', 'capture_binding_mismatch'],
  ['compromised review', p => p.report.review_integrity = 'compromised', 'blind_review_integrity_unmet'],
  ['four reviews already used', p => p.reviewsAlreadyUsed = 4, 'review_cap_exhausted'],
  ['null score', p => p.report.screens[0].scores.typography = null, 'invalid_score:typography'],
  ['weak criterion despite high total', p => p.report.screens[0].scores.restraint_coherence = 5, 'criterion_below_floor:restraint_coherence'],
  ['invented total', p => p.report.screens[0].total = 100, 'visual_total_unmet'],
  ['high visible issue', p => p.report.issues.push({ screenshot_id: 'S01', severity: 'high' }), 'unresolved_high_severity_issue'],
]) test(`review rejects ${name}`, () => {
  const packet = fixturePacket();
  mutate(packet);
  const result = evaluateReview(packet);
  assert.equal(result.status, 'design_review_blocked');
  assert.ok(result.failures.includes(expected));
});

test('last permitted revision is allowed; a weak screen cannot be averaged away', () => {
  const packet = fixturePacket();
  packet.reviewsAlreadyUsed = 3;
  assert.equal(evaluateReview(packet).status, 'metadata_policy_passed');
  packet.report.screens[0].scores.hierarchy_layout = 15;
  packet.report.screens[0].scores.typography = 12;
  packet.report.screens[0].total = 76;
  assert.ok(evaluateReview(packet).failures.includes('visual_total_unmet'));
});

function assertMetadataBlocked(packet, expected) {
  let result;
  assert.doesNotThrow(() => { result = evaluateReview(packet); });
  assert.equal(result.status, 'design_review_blocked');
  assert.ok(result.failures.includes(expected));
  assert.equal(result.operational_admission, 'blocked_runtime_attestation_unimplemented');
  assert.equal(result.functional_release_authorized, false);
}

test('missing and primitive packets return structured rejection', () => {
  for (const packet of [undefined, null, [], true, 1, 'FIXTURE_ONLY']) {
    assertMetadataBlocked(packet, 'invalid_review_packet');
  }
});

for (const field of ['report', 'receipt', 'capture', 'policy']) {
  test(`malformed ${field} structures are rejected before field access`, () => {
    for (const value of [undefined, null, [], true, 1, 'FIXTURE_ONLY']) {
      const packet = fixturePacket();
      packet[field] = value;
      assertMetadataBlocked(packet, `invalid_${field}_shape`);
    }
  });
}

for (const [name, mutate, expected] of [
  ['object instead of screens', p => p.report.screens = {}, 'incomplete_review_report'],
  ['null screen entry', p => p.report.screens = [null], 'incomplete_screen_report'],
  ['missing screen scores', p => delete p.report.screens[0].scores, 'incomplete_screen_report'],
  ['non-text strengths', p => p.report.screens[0].strengths = [1], 'incomplete_screen_report'],
  ['missing visible limitations', p => delete p.report.screens[0].visible_limitations, 'incomplete_screen_report'],
  ['duplicate screen identities', p => p.report.screens.push(structuredClone(p.report.screens[0])), 'duplicate_screenshot_id'],
  ['object instead of issues', p => p.report.issues = {}, 'incomplete_review_report'],
  ['incomplete issue entry', p => p.report.issues = [{}], 'incomplete_issue_report'],
  ['null issue entry', p => p.report.issues = [null], 'incomplete_issue_report'],
  ['unknown issue severity', p => p.report.issues = [{ ...completeIssue(), severity: 'critical' }], 'incomplete_issue_report'],
  ['unknown issue screenshot', p => p.report.issues = [{ ...completeIssue(), screenshot_id: 'unprovided-image' }], 'incomplete_issue_report'],
  ['missing issue observation', p => { const issue = completeIssue(); delete issue.observation; p.report.issues = [issue]; }, 'incomplete_issue_report'],
  ['object instead of subtraction array', p => p.report.subtract = {}, 'incomplete_review_report'],
  ['incomplete subtraction entry', p => p.report.subtract = [{}], 'incomplete_subtraction_report'],
  ['null subtraction entry', p => p.report.subtract = [null], 'incomplete_subtraction_report'],
  ['missing preservation statement', p => { const item = completeSubtraction(); delete item.preserve; p.report.subtract = [item]; }, 'incomplete_subtraction_report'],
  ['non-text image limitations', p => p.report.unverifiable_from_images = [null], 'incomplete_review_report'],
  ['null isolation', p => p.receipt.isolation = null, 'isolation_or_image_support_unverified'],
  ['object instead of critic input array', p => p.receipt.inputs = {}, 'disallowed_critic_context'],
  ['duplicated critic input', p => p.receipt.inputs.push(p.receipt.inputs[0]), 'disallowed_critic_context'],
  ['missing policy criteria', p => delete p.policy.criteria_maximum, 'invalid_policy_shape'],
  ['null policy criteria', p => p.policy.criteria_maximum = null, 'invalid_policy_shape'],
  ['missing policy isolation', p => delete p.policy.required_isolation, 'invalid_policy_shape'],
  ['object instead of policy input allowlist', p => p.policy.required_isolation.input_allowlist = {}, 'invalid_policy_shape'],
  ['weakened rubric maximum', p => p.policy.criteria_maximum.hierarchy_layout = 20, 'invalid_policy_shape'],
  ['weakened total threshold', p => p.policy.minimum_total = 84, 'invalid_policy_shape'],
  ['expanded revision cap', p => p.policy.max_revision_rounds_per_family = 4, 'invalid_policy_shape'],
]) test(`metadata shape rejects ${name}`, () => {
  const packet = fixturePacket();
  mutate(packet);
  assertMetadataBlocked(packet, expected);
});

function completeIssue() {
  return { screenshot_id: 'S01', location: 'Fixture header', severity: 'low', observation: 'Fixture label wraps.', visual_impact: 'Fixture reading rhythm changes.', revision_direction: 'Inspect the fixture label width.' };
}

function completeSubtraction() {
  return { screenshot_id: 'S01', location: 'Fixture inspector', remove_or_simplify: 'Repeated fixture heading.', preserve: 'Permission and provenance labels.' };
}

test('complete issue and subtraction shapes still grant no operational authority', () => {
  const packet = fixturePacket();
  packet.report.issues = [completeIssue()];
  packet.report.subtract = [completeSubtraction()];
  const result = evaluateReview(packet);
  assert.equal(result.status, 'metadata_policy_passed');
  assert.equal(result.operational_admission, 'blocked_runtime_attestation_unimplemented');
  assert.equal(result.functional_release_authorized, false);
});

test('CLI rejects missing, malformed JSON and primitive packets without a stack trace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'autopilot-review-packet-test-'));
  const malformed = join(root, 'malformed-fixture.json');
  const primitive = join(root, 'null-fixture.json');
  await writeFile(malformed, '{');
  await writeFile(primitive, 'null');
  const cli = new URL('./review-gate.mjs', import.meta.url);
  for (const input of [[], [malformed], [primitive]]) {
    const command = spawnSync(process.execPath, [fileURLToPath(cli), ...input], { encoding: 'utf8' });
    assert.equal(command.status, 1);
    assert.equal(command.stderr, '');
    const result = JSON.parse(command.stdout);
    assert.equal(result.status, 'design_review_blocked');
    assert.equal(result.operational_admission, 'blocked_runtime_attestation_unimplemented');
    assert.equal(result.functional_release_authorized, false);
  }
});
