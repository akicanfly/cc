import { APIError } from '@anthropic-ai/sdk/error'

type Schema = Record<string, unknown>
// Adapt only schema locations. A user property named "$schema" is still a property.
// RikkaHub's Gemini schema sanitizer uses the same separation of schema/data nodes.
export function adaptRejectedSchemas(body: Record<string, unknown>, message: string, onChange?: (keyword: string) => void): boolean {
  if (!/(?:parameters|json_schema|input_schema|function_declarations|\.schema)/i.test(message)) return false
  const rejected = new Set([...message.matchAll(/Unknown name ["']([^"']+)["']/g)].map(match => match[1]!))
  if (['type', 'properties', 'items', 'required'].some(key => rejected.has(key))) return false
  if (!rejected.size) return false
  let changed = false
  const adapt = (value: unknown, root = value, refs = new Set<string>()): unknown => {
    if (!isObject(value)) return value
    const schema = value
    if (rejected.has('$ref') && typeof schema.$ref === 'string') {
      const ref = schema.$ref
      if (!ref.startsWith('#/') || refs.has(ref) || refs.size >= 8) {
        throw invalidSchema('Provider rejects schema references and this tool schema cannot be safely resolved')
      }
      let resolved: unknown = root
      for (const key of ref.slice(2).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'))) {
        resolved = isObject(resolved) && Object.hasOwn(resolved, key) ? resolved[key] : undefined
      }
      if (!isObject(resolved)) throw invalidSchema('Provider rejects an unresolved tool schema reference')
      const { $ref: _ref, ...siblings } = schema
      changed = true
      onChange?.('$ref')
      return adapt({ ...resolved, ...siblings }, root, new Set([...refs, ref]))
    }
    const out: Schema = {}
    for (const [key, child] of Object.entries(schema)) {
      if (rejected.has(key)) {
        changed = true
        onChange?.(key)
        if (key === 'oneOf' && Array.isArray(child)) out.anyOf = child.map(item => adapt(item, root, refs))
        continue
      }
      if (key === 'properties' || key === '$defs' || key === 'definitions' || key === 'patternProperties') {
        out[key] = isObject(child) ? Object.fromEntries(Object.entries(child).map(([name, item]) => [name, adapt(item, root, refs)])) : child
      } else if (['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else'].includes(key)) {
        out[key] = adapt(child, root, refs)
      } else if (['anyOf', 'oneOf', 'allOf', 'prefixItems'].includes(key) && Array.isArray(child)) {
        out[key] = child.map(item => adapt(item, root, refs))
      } else out[key] = child
    }
    return out
  }
  if (Array.isArray(body.tools)) body.tools = body.tools.map(tool => {
    if (!isObject(tool)) return tool
    if (isObject(tool.function)) return { ...tool, function: { ...tool.function, parameters: adapt(tool.function.parameters) } }
    return { ...tool, parameters: adapt(tool.parameters) }
  })
  if (isObject(body.response_format) && isObject(body.response_format.json_schema)) {
    const format = body.response_format
    const jsonSchema = format.json_schema as Schema
    body.response_format = { ...format, json_schema: { ...jsonSchema, schema: adapt(jsonSchema.schema) } }
  }
  if (isObject(body.text) && isObject(body.text.format)) {
    body.text = { ...body.text, format: { ...body.text.format, schema: adapt(body.text.format.schema) } }
  }
  return changed
}

function isObject(value: unknown): value is Schema {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}


function invalidSchema(message: string): APIError {
  return APIError.generate(400, { error: { message } }, message, undefined)
}
