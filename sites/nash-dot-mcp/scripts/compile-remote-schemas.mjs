import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { _ } from 'ajv/dist/compile/codegen/index.js';

const source = new URL('../generated/remote-artifacts.json', import.meta.url);
const bytes = readFileSync(source);
const bundle = JSON.parse(bytes);
const ajv = new Ajv2020({ strict: false, useDefaults: true, ownProperties: true,
  code: { source: true, esm: true, formats: _`formats` } });
addFormats(ajv);
for (const [name, schema] of Object.entries(bundle.schemas)) ajv.addSchema(schema, name);
const exports = {};
function add(name, schema) { ajv.addSchema(schema, name); exports[name] = name; }
bundle.manifest.tools.forEach((tool, index) => { add(`tool_input_${index}`, tool.inputSchema); add(`tool_output_${index}`, tool.outputSchema); });
bundle.endpointTable.endpoints.forEach((endpoint, index) => {
  add(`endpoint_input_${index}`, { $ref: endpoint.request });
  add(`endpoint_output_${index}`, { $ref: endpoint.response });
});
add('endpoint_error', { $ref: bundle.endpointTable.errorSchema });
let code = standaloneCode(ajv, exports);
const imports = new Map();
code = code.replace(/require\("([^"]+)"\)/g, (_match, specifier) => {
  if (!imports.has(specifier)) imports.set(specifier, `runtime${imports.size}`);
  return imports.get(specifier);
});
if (/\brequire\s*\(|\bnew Function\b|\beval\s*\(/.test(code)) throw new Error('Unexpected runtime code generation in validators');
const prelude = ['import { fullFormats as formats } from "ajv-formats/dist/formats.js";',
  ...[...imports].map(([specifier, name]) => `import ${name} from ${JSON.stringify(`${specifier}.js`)};`)];
code = `// Generated from pinned R2 schemas. Regenerate; never hand-edit.\n${prelude.join('\n')}\n${code}\n`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const pins = `${JSON.stringify({ artifactBundleSha256: hash(bytes), validatorSha256: hash(code), ajv: '8.20.0' }, null, 2)}\n`;
const target = new URL('../generated/remote-validators.mjs', import.meta.url);
const pinTarget = new URL('../generated/remote-validator-pins.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== code || readFileSync(pinTarget, 'utf8') !== pins) throw new Error('Static validators are stale');
  process.stdout.write('Static R2 validators match pinned schemas.\n');
} else {
  writeFileSync(target, code); writeFileSync(pinTarget, pins);
  process.stdout.write('Generated static R2 validators; no runtime eval or schema compilation.\n');
}
