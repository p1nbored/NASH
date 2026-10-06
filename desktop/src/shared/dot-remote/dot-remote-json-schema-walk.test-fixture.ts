// FIXTURE_ONLY: walks generated JSON Schema documents for the dot remote contract tests.

type JsonNode = unknown

function isRecord(value: JsonNode): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function visit(
  node: JsonNode,
  at: string,
  onObject: (node: Record<string, unknown>, at: string) => void
): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => visit(child, `${at}/${index}`, onObject))
    return
  }
  if (!isRecord(node)) {
    return
  }
  onObject(node, at)
  for (const [key, child] of Object.entries(node)) {
    visit(child, `${at}/${key}`, onObject)
  }
}

/** JSON pointers of object schemas that would accept a key they do not declare. */
export function closedObjectViolations(schema: JsonNode): string[] {
  const violations: string[] = []
  visit(schema, '#', (node, at) => {
    if (node.type === 'object' && node.additionalProperties !== false) {
      violations.push(at)
    }
  })
  return violations
}

/** Every property name declared anywhere in the schema, sorted and unique. */
export function propertyNames(schema: JsonNode): string[] {
  const names = new Set<string>()
  visit(schema, '#', (node) => {
    if (isRecord(node.properties)) {
      for (const name of Object.keys(node.properties)) {
        names.add(name)
      }
    }
  })
  return [...names].sort()
}
