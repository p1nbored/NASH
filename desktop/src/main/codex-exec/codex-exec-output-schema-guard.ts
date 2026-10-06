// Refuses output schemas the local validator would compile into "accept anything" or could be made to stall on.

export type SchemaGuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly detail: string }

export const MAX_SCHEMA_CHARS = 64 * 1024
export const MAX_SCHEMA_DEPTH = 32
export const MAX_SCHEMA_NODES = 2_000
const LOCAL_REF = /^#\/(\$defs|definitions)\/([^/~]+)$/
/** A subschema using any of these without a `type` compiles to z.any(), which accepts everything. */
const STRUCTURAL_KEYWORDS = [
  'properties',
  'items',
  'required',
  'additionalProperties',
  'prefixItems'
]

type Frame = { readonly node: unknown; readonly depth: number }
type Root = Readonly<Record<string, unknown>>

const reject = (detail: string): SchemaGuardResult => ({ ok: false, detail })

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: object, key: string): boolean {
  return Object.hasOwn(record, key)
}

/** Every value in the document, so size and depth are bounded before anything recurses. */
function measureDocument(schema: Root): SchemaGuardResult {
  const stack: Frame[] = [{ node: schema, depth: 1 }]
  let nodes = 0
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    nodes += 1
    if (nodes > MAX_SCHEMA_NODES) {
      return reject(`The output schema has too many nodes (limit ${MAX_SCHEMA_NODES}).`)
    }
    if (frame.depth > MAX_SCHEMA_DEPTH) {
      return reject(`The output schema is nested too deep (limit ${MAX_SCHEMA_DEPTH}).`)
    }
    if (typeof frame.node === 'object' && frame.node !== null) {
      for (const child of Object.values(frame.node)) {
        stack.push({ node: child, depth: frame.depth + 1 })
      }
    }
  }
  return { ok: true }
}

function measureSerialised(schema: Root): SchemaGuardResult {
  try {
    return JSON.stringify(schema).length > MAX_SCHEMA_CHARS
      ? reject(`The output schema is too large (limit ${MAX_SCHEMA_CHARS} characters).`)
      : { ok: true }
  } catch {
    return reject('The output schema cannot be serialised to JSON.')
  }
}

function refProblem(ref: unknown, root: Root): string | null {
  if (ref === '#') {
    return null
  }
  const match = typeof ref === 'string' ? LOCAL_REF.exec(ref) : null
  const table = match === null ? undefined : root[match[1]]
  const known = match !== null && isPlainRecord(table) && hasOwn(table, match[2])
  return known ? null : 'A $ref must be "#" or name an own definition under $defs or definitions.'
}

function requiredProblem(node: Record<string, unknown>): string | null {
  if (!hasOwn(node, 'required')) {
    return null
  }
  const required = node.required
  const properties = node.properties
  const listed = Array.isArray(required) && required.every((name) => typeof name === 'string')
  if (!listed || !isPlainRecord(properties)) {
    return 'required must list names declared in properties.'
  }
  return required.every((name) => hasOwn(properties, name))
    ? null
    : 'required names a property that properties does not declare.'
}

function nodeProblem(node: Record<string, unknown>, root: Root): string | null {
  if (hasOwn(node, 'pattern') || hasOwn(node, 'patternProperties')) {
    return 'pattern and patternProperties are not allowed.'
  }
  if (STRUCTURAL_KEYWORDS.some((key) => hasOwn(node, key)) && typeof node.type !== 'string') {
    return 'A subschema with properties, items or required needs a string type.'
  }
  return (hasOwn(node, '$ref') ? refProblem(node.$ref, root) : null) ?? requiredProblem(node)
}

function childSchemas(node: Record<string, unknown>): unknown[] {
  const maps = ['properties', '$defs', 'definitions'].flatMap((key) => {
    const value = node[key]
    return isPlainRecord(value) ? Object.values(value) : []
  })
  const lists = ['prefixItems', 'anyOf', 'oneOf', 'allOf'].flatMap((key) => {
    const value = node[key]
    return Array.isArray(value) ? value : []
  })
  const single = ['items', 'additionalProperties'].flatMap((key) => {
    const value = node[key]
    return Array.isArray(value) ? value : value === undefined ? [] : [value]
  })
  return [...maps, ...lists, ...single]
}

function walkSchema(root: Root): SchemaGuardResult {
  const stack: unknown[] = [root]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (typeof node === 'boolean') {
      continue
    }
    if (!isPlainRecord(node)) {
      return reject('Every subschema must be an object or a boolean.')
    }
    const problem = nodeProblem(node, root)
    if (problem !== null) {
      return reject(problem)
    }
    stack.push(...childSchemas(node))
  }
  return { ok: true }
}

/** Accept only schemas the local validator can enforce: object root, typed structure, bounded size. */
export function guardOutputSchema(schema: Root): SchemaGuardResult {
  if (!isPlainRecord(schema)) {
    return reject('The output schema must be a JSON object.')
  }
  if (schema.type !== 'object') {
    return reject('The output schema root must have type "object".')
  }
  for (const check of [measureDocument, measureSerialised, walkSchema]) {
    const result = check(schema)
    if (!result.ok) {
      return result
    }
  }
  return { ok: true }
}
