import { describe, expect, test } from 'bun:test'
import { postCompatibleRequest } from './openaiCompatibleTransport.js'

const config = { baseURL: 'http://localhost:8080/v1', apiKey: 'test', headers: {}, timeoutMs: 1000 }

describe('compatible request fallbacks', () => {
  test('removes rejected optional parameters, retaining the prompt and tools', async () => {
    const requests: Array<Record<string, unknown>> = []
    const body = { model: 'local', stream: true, stream_options: { include_usage: true }, temperature: 0.7, messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function' }] }
    await postCompatibleRequest({
      config, path: '/chat/completions', body, signal: AbortSignal.timeout(1000),
      fetchOverride: async (_input, init) => {
        const request = JSON.parse(String(init?.body))
        requests.push(request)
        const param = 'stream_options' in request ? 'stream_options' : 'temperature' in request ? 'temperature' : undefined
        return param ? Response.json({ error: { message: 'Unsupported parameter', param } }, { status: 400 }) : Response.json({ choices: [] })
      },
    })
    expect(requests).toHaveLength(3)
    expect(requests[2]).toEqual({ model: 'local', stream: true, messages: body.messages, tools: body.tools })
    expect(body.temperature).toBe(0.7)
  })

  test('renames rejected token limits without dropping or looping over them', async () => {
    const limits: unknown[] = []
    await postCompatibleRequest({
      config, path: '/chat/completions', body: { max_tokens: 123 }, signal: AbortSignal.timeout(1000),
      fetchOverride: async (_input, init) => {
        const body = JSON.parse(String(init?.body))
        limits.push(body)
        return 'max_tokens' in body
          ? Response.json({ error: { message: 'max_tokens is not supported; use max_completion_tokens' } }, { status: 400 })
          : Response.json({})
      },
    })
    expect(limits).toEqual([{ max_tokens: 123 }, { max_completion_tokens: 123 }])
    let attempts = 0
    await expect(postCompatibleRequest({
      config, path: '/chat/completions', body: { max_tokens: 123 }, signal: AbortSignal.timeout(1000),
      fetchOverride: async (_input, init) => {
        attempts++
        const key = Object.keys(JSON.parse(String(init?.body)))[0]
        return Response.json({ error: { message: `unsupported ${key}` } }, { status: 400 })
      },
    })).rejects.toThrow('unsupported max_completion_tokens')
    expect(attempts).toBe(2)
  })

  test.each([400, 401, 403, 429, 500])('does not replay unrelated HTTP %s failures', async status => {
    let attempts = 0
    await expect(postCompatibleRequest({
      config, path: '/responses', body: { temperature: 1, tools: [{}] }, signal: AbortSignal.timeout(1000),
      fetchOverride: async () => {
        attempts++
        return Response.json({ error: { message: status === 400 ? 'unsupported tools' : 'unsupported temperature' } }, { status })
      },
    })).rejects.toThrow('unsupported')
    expect(attempts).toBe(1)
  })

  test('bounds fallback attempts even with several unsupported options', async () => {
    let attempts = 0
    await expect(postCompatibleRequest({
      config, path: '/chat/completions', body: { stream_options: {}, temperature: 1, top_p: 1, stop: ['end'] }, signal: AbortSignal.timeout(1000),
      fetchOverride: async (_input, init) => {
        attempts++
        const key = Object.keys(JSON.parse(String(init?.body)))[0]
        return Response.json({ error: { message: `unsupported ${key}` } }, { status: 422 })
      },
    })).rejects.toThrow('unsupported stop')
    expect(attempts).toBe(4)
  })

  test('honors cancellation before issuing a request', async () => {
    let called = false
    await expect(postCompatibleRequest({
      config, path: '/responses', body: {}, signal: AbortSignal.abort(),
      fetchOverride: async () => { called = true; return Response.json({}) },
    })).rejects.toThrow()
    expect(called).toBe(false)
  })

  test('honors custom headers without duplicate authorization values', async () => {
    await postCompatibleRequest({
      config: { ...config, headers: { authorization: 'Bearer override' } }, path: '/responses', body: {}, signal: AbortSignal.timeout(1000),
      fetchOverride: async (_input, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer override')
        return Response.json({})
      },
    })
  })

  test('preserves actionable nested proxy errors and request IDs', async () => {
    await expect(postCompatibleRequest({
      config, path: '/chat/completions', body: {}, signal: AbortSignal.timeout(1000),
      fetchOverride: async () => Response.json({ error: {
        message: 'Upstream rejected request',
        upstream: { message: JSON.stringify({ error: { message: 'tool_use.id: Field required' } }) },
      } }, { status: 400, headers: { 'x-request-id': 'proxy-request-1' } }),
    })).rejects.toMatchObject({ status: 400, requestID: 'proxy-request-1', message: expect.stringContaining('tool_use.id: Field required') })
  })
})

describe('safe compatibility policy', () => {
  test('keeps schemas unchanged unless the profile explicitly opts in', async () => {
    let attempts = 0
    const body = { tools: [{ function: { parameters: { type: 'object', $schema: 'dialect' } } }] }
    await expect(postCompatibleRequest({ config, path: '/chat/completions', body, signal: AbortSignal.timeout(1000), fetchOverride: async () => {
      attempts++
      return Response.json({ error: { message: 'Unknown name "$schema" at parameters' } }, { status: 400 })
    } })).rejects.toMatchObject({ status: 400 })
    expect(attempts).toBe(1)
    expect(body.tools[0].function.parameters.$schema).toBe('dialect')
  })
  test('reports schema changes without exposing schema contents', async () => {
    const notices: string[] = []
    await postCompatibleRequest({ config: { ...config, schemaFallback: true }, path: '/chat/completions', body: { tools: [{ function: { parameters: { type: 'object', $schema: 'private-value' } } }] }, signal: AbortSignal.timeout(1000), onFallback: notice => notices.push(notice), fetchOverride: async (_input, init) => {
      const body = JSON.parse(String(init?.body))
      return body.tools[0].function.parameters.$schema ? Response.json({ error: { message: 'Unknown name "$schema" at parameters' } }, { status: 400 }) : Response.json({})
    } })
    expect(notices).toEqual(['Provider compatibility fallback: adapted unsupported schema keywords: $schema'])
    expect(notices.join('')).not.toContain('private-value')
  })
  test('does not remove a supported parameter mentioned in an unrelated error', async () => {
    let attempts = 0
    await expect(postCompatibleRequest({ config, path: '/chat/completions', body: { temperature: 1 }, signal: AbortSignal.timeout(1000), fetchOverride: async () => {
      attempts++
      return Response.json({ error: { message: 'Unsupported tools; temperature must be valid', param: 'tools' } }, { status: 400 })
    } })).rejects.toThrow('Unsupported tools')
    expect(attempts).toBe(1)
  })
})
