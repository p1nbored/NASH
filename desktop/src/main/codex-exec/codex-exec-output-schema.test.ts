import { describe, expect, it } from 'vitest'
import { compileOutputSchema, type OutputSchemaCheck } from './codex-exec-output-schema'

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    status: { enum: ['ok', 'blocked'] },
    files: { type: 'array', items: { type: 'string' } }
  },
  required: ['summary', 'status'],
  additionalProperties: false
}

function validatorFor(schema: Readonly<Record<string, unknown>> = SCHEMA) {
  const compiled = compileOutputSchema(schema)
  if (!compiled.ok) {
    throw new Error(`schema should compile: ${compiled.detail}`)
  }
  return compiled.validate
}

function failureDetail(check: OutputSchemaCheck): string {
  if (check.ok) {
    throw new Error('expected a schema violation')
  }
  return check.detail
}

describe('compileOutputSchema', () => {
  it('accepts a conforming document, tolerating surrounding whitespace', () => {
    const validate = validatorFor()
    expect(validate('{"summary":"done","status":"ok","files":["a.ts"]}')).toEqual({ ok: true })
    expect(validate('\n  {"summary":"done","status":"blocked"}  \n')).toEqual({ ok: true })
  })

  it.each([
    ['missing required property', '{"summary":"done"}'],
    ['wrong property type', '{"summary":5,"status":"ok"}'],
    ['value outside the enum', '{"summary":"x","status":"maybe"}'],
    ['extra property', '{"summary":"x","status":"ok","extra":1}'],
    ['wrong array item type', '{"summary":"x","status":"ok","files":[1]}'],
    ['top-level array', '[]'],
    ['top-level string', '"ok"'],
    ['not JSON', 'Here is the result: done'],
    ['markdown-fenced JSON', '```json\n{"summary":"x","status":"ok"}\n```'],
    ['empty text', '']
  ])('rejects %s', (_label, text) => {
    expect(validatorFor()(text).ok).toBe(false)
  })

  it('does not echo the offending value in the violation detail', () => {
    const detail = failureDetail(validatorFor()('{"summary":"x","status":"SECRET-VALUE-SENTINEL"}'))
    expect(detail).not.toContain('SECRET-VALUE-SENTINEL')
    expect(detail.length).toBeLessThanOrEqual(400)
    expect(detail).toContain('status')
  })

  it('reports an unsupported schema as not compilable instead of passing everything', () => {
    for (const schema of [
      { not: { type: 'string' } },
      JSON.parse('{"if":{"type":"string"},"then":{"minLength":1}}'),
      { $ref: 'https://example.invalid/schema.json' }
    ]) {
      const compiled = compileOutputSchema(schema)
      expect(compiled.ok).toBe(false)
    }
  })

  it('rejects a schema that is not a JSON object', () => {
    // JSON.parse yields `any`, standing in for a schema that arrived from untyped input.
    expect(compileOutputSchema(JSON.parse('["not","an","object"]')).ok).toBe(false)
    expect(compileOutputSchema(JSON.parse('null')).ok).toBe(false)
  })
})

describe('compileOutputSchema fail-closed guard', () => {
  const object = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    type: 'object',
    properties,
    ...extra
  })
  const rejected = (schema: Record<string, unknown>): string => {
    const compiled = compileOutputSchema(schema)
    if (compiled.ok) {
      throw new Error('expected the schema to be rejected')
    }
    return compiled.detail
  }

  it.each([
    ['a root without a type', { properties: { a: { type: 'string' } }, required: ['a'] }],
    ['an array root', { type: 'array', items: { type: 'string' } }],
    ['a root whose type is a list', { type: ['object', 'null'], properties: {} }],
    ['an untyped nested object', object({ a: { properties: { b: { type: 'string' } } } })],
    [
      'untyped array items with structure',
      object({ a: { type: 'array', items: { required: [] } } })
    ],
    ['a required name that is not a property', { type: 'object', required: ['answer'] }],
    [
      'a required name missing from properties',
      object({ a: { type: 'string' } }, { required: ['b'] })
    ],
    [
      'a nested required name missing from properties',
      object({ a: object({ x: { type: 'string' } }, { required: ['y'] }) })
    ],
    ['a pattern', object({ a: { type: 'string', pattern: '^(a+)+$' } })],
    [
      'a patternProperties map',
      object({}, { patternProperties: { '^(a+)+$': { type: 'string' } } })
    ],
    ['a $ref to a name no definition has', object({ a: { $ref: '#/$defs/constructor' } })],
    ['a $ref that is not local', object({ a: { $ref: 'https://example.invalid/x.json' } })],
    ['required that is not a list of strings', object({ a: { type: 'string' } }, { required: [1] })]
  ])('rejects %s', (_label, schema) => {
    expect(rejected(schema).length).toBeGreaterThan(0)
  })

  it('accepts local definitions, boolean subschemas and typeless leaf constraints', () => {
    const schema = object(
      { a: { $ref: '#/$defs/item' }, b: { enum: ['x', 'y'] } },
      { $defs: { item: { type: 'string' } }, additionalProperties: false, required: ['a'] }
    )
    const validate = validatorFor(schema)
    expect(validate('{"a":"x","b":"y"}')).toEqual({ ok: true })
    expect(validate('{"a":1}').ok).toBe(false)
  })

  it('caps the schema size', () => {
    const wide = object(
      Object.fromEntries(
        Array.from({ length: 3000 }, (_, index) => [`field_${index}`, { type: 'string' }])
      )
    )
    expect(rejected(wide)).toMatch(/too large|too many/i)
  })

  it('caps the schema depth', () => {
    let nested: Record<string, unknown> = { type: 'string' }
    for (let level = 0; level < 60; level += 1) {
      nested = object({ child: nested })
    }
    expect(rejected(nested)).toMatch(/deep/i)
  })

  it('refuses a schema that cannot be serialised', () => {
    const circular: Record<string, unknown> = { type: 'object', properties: {} }
    circular.properties = { self: circular }
    expect(compileOutputSchema(circular).ok).toBe(false)
  })
})

describe('compileOutputSchema validation limits', () => {
  const recursive = { type: 'object', properties: { a: { $ref: '#' } } }

  it('refuses text above the validated length without parsing it', () => {
    const compiled = compileOutputSchema(SCHEMA, { maxTextChars: 100 })
    if (!compiled.ok) {
      throw new Error('schema should compile')
    }
    const check = compiled.validate(`{"summary":"${'x'.repeat(200)}","status":"ok"}`)
    expect(check).toMatchObject({ ok: false, kind: 'violation' })
  })

  it('reports a deeply nested document as a violation instead of letting the validator overflow', () => {
    const deep = `${'{"a":'.repeat(60_000)}{}${'}'.repeat(60_000)}`
    const check = validatorFor(recursive)(deep)
    expect(check).toMatchObject({ ok: false, kind: 'violation' })
    expect(failureDetail(check)).toMatch(/deep/i)
  })

  it('maps a validator that throws to unvalidatable and never lets it escape', () => {
    const compiled = compileOutputSchema(recursive, { maxValueDepth: 1_000_000 })
    if (!compiled.ok) {
      throw new Error('schema should compile')
    }
    const deep = `${'{"a":'.repeat(60_000)}{}${'}'.repeat(60_000)}`
    expect(compiled.validate(deep)).toMatchObject({ ok: false, kind: 'unvalidatable' })
  })

  it('marks an ordinary mismatch as a violation', () => {
    expect(validatorFor()('{"summary":5,"status":"ok"}')).toMatchObject({
      ok: false,
      kind: 'violation'
    })
  })
})
