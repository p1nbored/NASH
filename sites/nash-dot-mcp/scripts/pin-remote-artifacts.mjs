import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../../desktop/orca/src/shared/', import.meta.url);
const remote = new URL('dot-remote/', root);
const files = ['dot-mcp-tool-manifest.json', 'dot-remote-endpoints.json', 'dot-remote-conformance-vectors.json',
  'dot-remote-inbox.schema.json', 'dot-remote-ack.schema.json', 'dot-remote-receipt.schema.json',
  'dot-remote-events.schema.json', 'dot-remote-presence.schema.json', 'dot-remote-pairing.schema.json'];
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const documents = {};
const pins = {};
for (const file of files) { const bytes = readFileSync(new URL(file, remote)); documents[file] = JSON.parse(bytes); pins[file] = hash(bytes); }
const goldenBytes = readFileSync(new URL('dot-ingress/dot-ingress-contract-v3.schema.json', root));
const golden = JSON.parse(goldenBytes);
pins['dot-ingress-contract-v3.schema.json'] = hash(goldenBytes);
const manifest = documents['dot-mcp-tool-manifest.json'];
const vectors = documents['dot-remote-conformance-vectors.json'];
const { manifestSha256, ...unhashed } = manifest;
if (hash(canonical(unhashed)) !== manifestSha256 || vectors.manifestSha256 !== manifestSha256) throw new Error('Manifest/vector canonical hash mismatch');
if (manifest.contractGolden.sha256 !== hash(goldenBytes)) throw new Error('v3 golden pin mismatch');
if (manifest.tools.length !== 12 || vectors.vectors.length !== 37 || documents['dot-remote-endpoints.json'].endpoints.length !== 13) throw new Error('Unexpected R2 artifact counts');
const output = { pins, manifest, endpointTable: documents['dot-remote-endpoints.json'], vectors, golden,
  schemas: Object.fromEntries(files.filter((file) => file.endsWith('.schema.json')).map((file) => [file, documents[file]])) };
const contents = `${JSON.stringify(output, null, 2)}\n`;
const target = new URL('../generated/remote-artifacts.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== contents) throw new Error('Pinned R2 artifacts drifted; review the source before repinning');
  process.stdout.write('Pinned R2 artifacts match source hashes.\n');
} else {
  writeFileSync(target, contents);
  process.stdout.write(`Pinned R2 manifest ${manifestSha256}; 12 tools, 13 routes and 37 vectors.\n`);
}
