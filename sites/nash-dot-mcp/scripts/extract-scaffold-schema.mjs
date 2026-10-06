import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../../../desktop/orca/src/shared/dot-ingress/dot-ingress-contract-v2.schema.json', import.meta.url);
const bytes = readFileSync(source);
const contract = JSON.parse(bytes.toString('utf8'));
function inline(value) {
  if (Array.isArray(value)) return value.map(inline);
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) {
    if (!value.$ref.startsWith('#/$defs/')) throw new Error('Unsupported contract reference');
    const definition = contract.$defs[value.$ref.slice('#/$defs/'.length)];
    if (!definition) throw new Error('Missing contract definition');
    const { $ref, ...siblings } = value;
    return { ...inline(definition), ...inline(siblings) };
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inline(item)]));
}
const schema = inline(contract.properties['params.hello']);
if (schema.properties.contractVersion.const !== 2) throw new Error('Expected contract v2');
const output = new URL('../generated/', import.meta.url);
mkdirSync(output, { recursive: true });
writeFileSync(new URL('dot-hello-schema.json', output), `${JSON.stringify({
  source: 'desktop/orca/src/shared/dot-ingress/dot-ingress-contract-v2.schema.json',
  sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  schema,
}, null, 2)}\n`);
process.stdout.write('Extracted v2 hello schema for scaffold status; no remote manifest generated.\n');
