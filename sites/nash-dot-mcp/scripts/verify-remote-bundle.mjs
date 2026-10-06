import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const bundle = JSON.parse(readFileSync(new URL('../generated/remote-artifacts.json', import.meta.url)));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const documents = { ...bundle.schemas, 'dot-mcp-tool-manifest.json': bundle.manifest,
  'dot-remote-endpoints.json': bundle.endpointTable, 'dot-remote-conformance-vectors.json': bundle.vectors,
  'dot-ingress-contract-v3.schema.json': bundle.golden };
for (const [name, doc] of Object.entries(documents)) {
  if (hash(`${JSON.stringify(doc, null, 2)}\n`) !== bundle.pins[name]) throw new Error('Bundled artifact pin mismatch');
}
const { manifestSha256, ...manifest } = bundle.manifest;
if (hash(canonical(manifest)) !== manifestSha256 || bundle.vectors.manifestSha256 !== manifestSha256) throw new Error('Bundled manifest/vector mismatch');
if (bundle.manifest.contractGolden.sha256 !== bundle.pins['dot-ingress-contract-v3.schema.json']) throw new Error('Bundled contract mismatch');
process.stdout.write('Standalone bundled R2 pins verified; no parent App checkout required.\n');
