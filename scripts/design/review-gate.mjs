import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, repository } from './repository-root-and-sha256.mjs';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isTextArray = value => Array.isArray(value) && value.every(isText);
const criterionMaximums = { hierarchy_layout: 25, typography: 20, color_readability: 20, density_task_focus: 15, restraint_coherence: 10, craft_consistency: 10 };
const criticInputs = ['unchanged_standalone_prompt', 'anonymized_screenshot_ids', 'image_dimensions', 'image_pixels'];

function reviewResult(failures) {
  // Caller metadata cannot attest runtime isolation, reserve budget or authorize release.
  return { status: failures.length ? 'design_review_blocked' : 'metadata_policy_passed', failures, operational_admission: 'blocked_runtime_attestation_unimplemented', functional_release_authorized: false };
}

function validPolicy(policy) {
  return isRecord(policy) && isRecord(policy.criteria_maximum) &&
    Object.keys(policy.criteria_maximum).length === Object.keys(criterionMaximums).length &&
    Object.entries(criterionMaximums).every(([key, maximum]) => policy.criteria_maximum[key] === maximum) &&
    Number.isInteger(policy.minimum_total) && policy.minimum_total >= 85 && policy.minimum_total <= 100 &&
    Number.isFinite(policy.minimum_criterion_fraction) && policy.minimum_criterion_fraction >= 0.6 && policy.minimum_criterion_fraction <= 1 &&
    policy.max_initial_reviews_per_family === 1 && Number.isInteger(policy.max_revision_rounds_per_family) &&
    policy.max_revision_rounds_per_family >= 0 && policy.max_revision_rounds_per_family <= 3 &&
    isRecord(policy.required_isolation) && isTextArray(policy.required_isolation.input_allowlist) &&
    policy.required_isolation.input_allowlist.length === criticInputs.length &&
    criticInputs.every(input => policy.required_isolation.input_allowlist.includes(input));
}

export function evaluateReview(packet) {
  if (!isRecord(packet)) return reviewResult(['invalid_review_packet']);
  const { report, receipt, capture, policy, promptHash, reviewsAlreadyUsed = 0 } = packet;
  const failures = [];
  if (!isRecord(report)) failures.push('invalid_report_shape');
  if (!isRecord(receipt)) failures.push('invalid_receipt_shape');
  if (!isRecord(capture)) failures.push('invalid_capture_shape');
  if (!validPolicy(policy)) failures.push('invalid_policy_shape');
  if (failures.length) return reviewResult(failures);

  const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  if (![promptHash, receipt.prompt_sha256, capture.sha256, receipt.capture_sha256].every(validHash)) failures.push('invalid_evidence_hash');
  if (capture.kind !== 'application_renderer' || !isText(capture.id) || !isText(capture.source_revision) || !capture.sha256) failures.push('actual_application_capture_required');
  if (receipt.prompt_sha256 !== promptHash) failures.push('fixed_prompt_mismatch');
  if (receipt.route_source !== 'clef' || ![receipt.route_decision_id, receipt.task_id, receipt.reported_surface].every(isText)) failures.push('registered_clef_route_required');
  const isolation = receipt.isolation;
  if (!isRecord(isolation) || isolation.inherited_task_context !== false || isolation.repository_access !== false || isolation.network_access !== false || isolation.terminal_access !== false || isolation.image_input_verified !== true || !isText(isolation.enforcement_evidence)) failures.push('isolation_or_image_support_unverified');
  const allowed = new Set(policy.required_isolation.input_allowlist);
  if (!isTextArray(receipt.inputs) || receipt.inputs.length !== allowed.size || receipt.inputs.some(input => !allowed.has(input)) || new Set(receipt.inputs).size !== allowed.size) failures.push('disallowed_critic_context');
  const screens = Array.isArray(report.screens) ? report.screens : [];
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const subtract = Array.isArray(report.subtract) ? report.subtract : [];
  if (!Array.isArray(report.screens) || !screens.length || !Array.isArray(report.issues) || issues.length > 5 || !Array.isArray(report.subtract) || subtract.length > 3 || !isTextArray(report.unverifiable_from_images) || !['ready_for_human_review', 'revise', 'insufficient_evidence'].includes(report.visual_readiness) || !isText(report.summary)) failures.push('incomplete_review_report');
  const validScreen = screen => isRecord(screen) && isText(screen.screenshot_id) && isRecord(screen.scores) &&
    Object.keys(screen.scores).length === Object.keys(criterionMaximums).length &&
    Object.entries(criterionMaximums).every(([key, maximum]) => screen.scores[key] === null || (Number.isInteger(screen.scores[key]) && screen.scores[key] >= 0 && screen.scores[key] <= maximum)) &&
    (screen.total === null || (Number.isInteger(screen.total) && screen.total >= 0 && screen.total <= 100)) &&
    isTextArray(screen.strengths) && isTextArray(screen.visible_limitations);
  if (screens.some(screen => !validScreen(screen))) failures.push('incomplete_screen_report');
  const screenIds = screens.filter(isRecord).map(screen => screen.screenshot_id);
  if (new Set(screenIds).size !== screenIds.length) failures.push('duplicate_screenshot_id');
  const validIssue = issue => isRecord(issue) && [issue.screenshot_id, issue.location, issue.observation, issue.visual_impact, issue.revision_direction].every(isText) &&
    screenIds.includes(issue.screenshot_id) && ['high', 'medium', 'low'].includes(issue.severity);
  if (issues.some(issue => !validIssue(issue))) failures.push('incomplete_issue_report');
  const validSubtraction = item => isRecord(item) && [item.screenshot_id, item.location, item.remove_or_simplify, item.preserve].every(isText) && screenIds.includes(item.screenshot_id);
  if (subtract.some(item => !validSubtraction(item))) failures.push('incomplete_subtraction_report');
  if (receipt.capture_sha256 !== capture.sha256 || receipt.capture_id !== capture.id) failures.push('capture_binding_mismatch');
  if (report.review_integrity !== 'clean') failures.push('blind_review_integrity_unmet');
  if (!Number.isInteger(reviewsAlreadyUsed) || reviewsAlreadyUsed < 0 || reviewsAlreadyUsed >= policy.max_initial_reviews_per_family + policy.max_revision_rounds_per_family) failures.push('review_cap_exhausted');
  const screen = screens.find(s => isRecord(s) && s.screenshot_id === capture.id);
  if (!screen) failures.push('screen_missing');
  else {
    const scores = Object.entries(policy.criteria_maximum).map(([key, maximum]) => {
      const score = isRecord(screen.scores) ? screen.scores[key] : undefined;
      if (!Number.isInteger(score) || score < 0 || score > maximum) failures.push(`invalid_score:${key}`);
      else if (score < maximum * policy.minimum_criterion_fraction) failures.push(`criterion_below_floor:${key}`);
      return score;
    });
    const total = scores.reduce((sum, score) => sum + (Number.isInteger(score) ? score : 0), 0);
    if (screen.total !== total || total < policy.minimum_total) failures.push('visual_total_unmet');
  }
  if (issues.some(issue => isRecord(issue) && issue.severity === 'high' && issue.screenshot_id === capture.id)) failures.push('unresolved_high_severity_issue');
  return reviewResult(failures);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [packetPath] = process.argv.slice(2);
  let result;
  try {
    if (!packetPath) result = reviewResult(['review_packet_required']);
    else {
      const packet = JSON.parse(await readFile(resolve(packetPath), 'utf8'));
      const policy = JSON.parse(await readFile(resolve(repository, 'docs/design/review-policy.json'), 'utf8'));
      const promptHash = hash(await readFile(resolve(repository, 'docs/design/review-prompt.md')));
      result = isRecord(packet) ? evaluateReview({ ...packet, policy, promptHash }) : reviewResult(['invalid_review_packet']);
    }
  } catch {
    result = reviewResult(['review_input_invalid_or_unavailable']);
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.failures.length ? 1 : 0;
}
