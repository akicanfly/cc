import { describe, expect, test } from 'bun:test'
import { adaptRejectedSchemas } from './openaiCompatibleSchema.js'
import { postCompatibleRequest } from './openaiCompatibleTransport.js'

const rejection = 'Unknown name "$schema" at request.tools[0].function_declarations[0].parameters. Unknown name "propertyNames" at parameters.properties[0].value'

describe('restricted provider schema fallback', () => {
  test('removes rejected schema keywords without touching property names or example data', () => {
    const schema = { $schema: 'dialect', type: 'object', properties: {
      $schema: { type: 'string' }, bag: { type: 'object', propertyNames: { pattern: '^a' }, default: { propertyNames: 'data' } },
    } }
    const body: any = { tools: [{ type: 'function', function: { name: 'Read', parameters: schema } }] }
    expect(adaptRejectedSchemas(body, rejection)).toBe(true)
    const adapted = body.tools[0].function.parameters
    expect(adapted.$schema).toBeUndefined()
    expect(adapted.properties.$schema).toEqual({ type: 'string' })
    expect(adapted.properties.bag.propertyNames).toBeUndefined()
    expect(adapted.properties.bag.default).toEqual({ propertyNames: 'data' })
    expect(schema.$schema).toBe('dialect')
    expect(body.tools[0].function.name).toBe('Read')
  })

  test('resolves local refs with a cycle bound', () => {
    const body: any = { tools: [{ parameters: { type: 'object', properties: { value: { $ref: '#/$defs/Value' } }, $defs: { Value: { type: 'string' } } } }] }
    expect(adaptRejectedSchemas(body, 'Unknown name "$ref" at parameters')).toBe(true)
    expect(body.tools[0].parameters.properties.value).toEqual({ type: 'string' })
    expect(() => adaptRejectedSchemas({ tools: [{ parameters: { $ref: '#/$defs/Self', $defs: { Self: { $ref: '#/$defs/Self' } } } }] }, 'Unknown name "$ref" at parameters')).toThrow('safely resolved')
  })

  test('does not weaken essential schema structure or alter ordinary requests', () => {
    const body = { tools: [{ parameters: { type: 'object', properties: {} } }] }
    expect(adaptRejectedSchemas(body, 'Unknown name "properties" at parameters')).toBe(false)
    expect(adaptRejectedSchemas(body, 'unsupported model')).toBe(false)
  })

  test('adapts only after an explicit backend schema rejection', async () => {
    const bodies: any[] = []
    await postCompatibleRequest({
      config: { baseURL: 'http://localhost/v1', headers: {}, timeoutMs: 1000, schemaFallback: true }, path: '/chat/completions',
      body: { model: 'local', tools: [{ type: 'function', function: { name: 'Read', parameters: { $schema: 'dialect', type: 'object' } } }] },
      signal: AbortSignal.timeout(1000),
      fetchOverride: async (_input, init) => {
        const body = JSON.parse(String(init?.body))
        bodies.push(body)
        return body.tools[0].function.parameters.$schema
          ? Response.json({ error: { message: rejection } }, { status: 400 })
          : Response.json({ choices: [] })
      },
    })
    expect(bodies).toHaveLength(2)
    expect(bodies[0].tools[0].function.parameters.$schema).toBe('dialect')
    expect(bodies[1].tools[0].function.parameters).toEqual({ type: 'object' })
  })
})
