import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk/error'
import { createOpenAICompatibleAnthropicClient } from './openaiCompatible.js'

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://provider.example/v1'
  process.env.OPENAI_COMPATIBLE_API_KEY = 'test-key'
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_KEY
})

afterEach(() => {
  process.env = { ...originalEnv }
})

function params(overrides: Record<string, unknown> = {}) {
  return {
    model: 'gpt-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: 'hello' }],
    stream: false,
    ...overrides,
  }
}

describe('OpenAI-compatible adapter', () => {
  test('accepts a JSON completion from a provider that ignores stream=true', async () => {
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }),
    }) as any
    const { data } = await client.beta.messages.create(params({ stream: true })).withResponse()
    const events: any[] = []
    for await (const event of data) events.push(event)
    expect(events.find(e => e.delta?.type === 'text_delta')?.delta.text).toBe('ok')
    expect(events.at(-1).type).toBe('message_stop')
  })

  test('round-trips opaque OpenRouter reasoning and cache breakpoints', async () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://openrouter.ai/api/v1'
    const details = [{ index: 0, type: 'reasoning.encrypted', data: 'opaque' }]
    const requests: any[] = []
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async (_input, init) => {
        requests.push(JSON.parse(String(init?.body)))
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'ok', reasoning_details: details } }] })
      },
    }) as any
    const first = await client.beta.messages.create(params({
      system: [{ type: 'text', text: 'stable', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi', cache_control: { type: 'ephemeral' } }] }],
    }))
    await client.beta.messages.create(params({ messages: [{ role: 'assistant', content: first.content }] }))
    expect(requests[1].messages[0].reasoning_details).toEqual(details)
    expect(requests[0].messages[0].content[0].cache_control.type).toBe('ephemeral')
    expect(requests[0].messages[1].content[0].cache_control.type).toBe('ephemeral')
    expect(requests[0].usage).toEqual({ include: true })
    expect(requests[0]).not.toHaveProperty('reasoning_effort')
  })

  test('accumulates streamed OpenRouter reasoning metadata before closing its block', async () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://openrouter.ai/api/v1'
    const chunks = [
      { choices: [{ delta: { reasoning_details: [{ index: 0, type: 'reasoning.encrypted', data: 'first' }] } }] },
      { choices: [{ delta: { reasoning_details: [{ index: 0, data: 'second' }] } }] },
      { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
    ]
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async () => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'),
    }) as any
    const { data } = await client.beta.messages.create(params({ stream: true })).withResponse()
    const events: any[] = []
    for await (const event of data) events.push(event)
    const signature = events.find(e => e.delta?.type === 'signature_delta')
    expect(JSON.parse(signature.delta.signature.slice('ccc-openrouter:'.length))).toEqual([
      { index: 0, type: 'reasoning.encrypted', data: 'firstsecond' },
    ])
    expect(events.filter(e => e.type === 'content_block_start').map(e => e.content_block.type)).toEqual(['thinking', 'text'])
  })

  test('uses custom chat paths and reports connection failures with a safe origin', async () => {
    process.env.OPENAI_COMPATIBLE_CHAT_COMPLETIONS_PATH = '/custom/chat'
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async input => {
        expect(String(input)).toBe('https://provider.example/v1/custom/chat')
        throw Object.assign(new Error('failed'), { code: 'ECONNREFUSED' })
      },
    }) as any
    await expect(client.beta.messages.create(params())).rejects.toThrow('https://provider.example (ECONNREFUSED)')
  })

  test('normalizes non-streaming reasoning and text content arrays', async () => {
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async () => Response.json({
        choices: [{ finish_reason: 'stop', message: { content: [
          { type: 'thinking', thinking: [{ type: 'text', text: 'reason' }] },
          { type: 'text', text: 'answer' },
        ] } }],
      }),
    }) as any
    expect((await client.beta.messages.create(params())).content).toEqual([
      { type: 'thinking', thinking: 'reason', signature: '' },
      { type: 'text', text: 'answer' },
    ])
  })

  test('retains reasoning history and lifts tool images after all tool results', async () => {
    let body: any
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async (_input, init) => {
        body = JSON.parse(String(init?.body))
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] })
      },
    }) as any
    await client.beta.messages.create(params({ messages: [
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'reason' },
        { type: 'tool_use', id: 'one', name: 'Read', input: {} },
        { type: 'tool_use', id: 'two', name: 'Read', input: {} },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'one', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }] },
        { type: 'tool_result', tool_use_id: 'two', content: 'done' },
      ] },
    ] }))
    expect(body.messages.map((m: any) => m.role)).toEqual(['assistant', 'tool', 'tool', 'user'])
    expect(body.messages[0].reasoning_content).toBe('reason')
    expect(body.messages[1].content).toContain('Image output attached')
    expect(body.messages[3].content[1].image_url.url).toBe('data:image/png;base64,aGVsbG8=')
  })

  test('streams complete tool calls followed by text without overlapping blocks', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'before' } }] },
      { choices: [{ delta: { tool_calls: [{ id: 'one', function: { name: 'Read', arguments: '{}' } }, { id: 'two', function: { name: 'Read', arguments: '{}' } }] } }] },
      { choices: [{ delta: { content: 'after' }, finish_reason: 'tool_calls' }] },
    ]
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async () => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'),
    }) as any
    const { data } = await client.beta.messages.create(params({ stream: true, tools: [{ name: 'Read', input_schema: { type: 'object' } }] })).withResponse()
    const events: any[] = []
    for await (const event of data) events.push(event)
    const starts = events.filter(e => e.type === 'content_block_start')
    expect(starts.map(e => e.content_block.type)).toEqual(['text', 'tool_use', 'tool_use', 'text'])
    expect(starts.map(e => e.index)).toEqual([0, 1, 2, 3])
    const open = new Set<number>()
    for (const e of events) {
      if (e.type === 'content_block_start') { expect(open.size).toBe(0); open.add(e.index) }
      if (e.type === 'content_block_stop') { expect(open.delete(e.index)).toBe(true) }
    }
    expect(open.size).toBe(0)
  })

  test('applies optional parameter fallback before opening a stream', async () => {
    let attempts = 0
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async (_input, init) => {
        attempts++
        const body = JSON.parse(String(init?.body))
        return body.stream_options
          ? Response.json({ error: { message: 'stream_options is unsupported' } }, { status: 400 })
          : new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
      },
    }) as any
    const { data } = await client.beta.messages.create(params({ stream: true })).withResponse()
    const events: any[] = []
    for await (const event of data) events.push(event)
    expect(attempts).toBe(2)
    expect(events.at(-1).type).toBe('message_stop')
  })

  test('surfaces in-stream errors without replaying a generation', async () => {
    let attempts = 0
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async () => {
        attempts++
        return new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"unsupported temperature"}}\n\n')
      },
    }) as any
    const { data } = await client.beta.messages.create(params({ stream: true })).withResponse()
    await expect((async () => { for await (const _event of data) { /* drain */ } })()).rejects.toThrow('unsupported temperature')
    expect(attempts).toBe(1)
  })

  test.each(['none', 'low', 'high', 'max'])('omits reasoning effort %s for providers that reject it', async effort => {
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async (_input, init) => {
        const body = JSON.parse(String(init?.body))
        if ('reasoning_effort' in body || 'reasoning' in body) {
          return Response.json(
            { error: { message: 'unsupported reasoning_effort' } },
            { status: 400 },
          )
        }
        return Response.json({
          choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        })
      },
    }) as any

    const response = await client.beta.messages.create(
      params({ output_config: { effort }, thinking: { type: 'enabled', budget_tokens: 1024 } }),
    )

    expect(response.content).toEqual([{ type: 'text', text: 'ok' }])
  })

  test('supports local providers without injecting an authorization header', async () => {
    delete process.env.OPENAI_COMPATIBLE_API_KEY
    let authorization: string | null | undefined
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization')
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
          }),
        )
      },
    }) as any

    await client.beta.messages.create(params({ model: 'local-model' }))

    expect(authorization).toBeNull()
  })

  test('uses max_completion_tokens and maps cached usage without double counting', async () => {
    let requestBody: Record<string, unknown> | undefined
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(
          JSON.stringify({
            id: 'chatcmpl_1',
            choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 12,
              prompt_tokens_details: { cached_tokens: 40 },
            },
          }),
          { status: 200 },
        )
      },
    }) as any

    const response = await client.beta.messages.create(params())

    expect(requestBody?.max_completion_tokens).toBe(4096)
    expect(requestBody?.max_tokens).toBeUndefined()
    expect(response.usage).toEqual({
      input_tokens: 60,
      output_tokens: 12,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 0,
    })
  })

  test('translates JSON schema output configuration', async () => {
    let requestBody: Record<string, any> | undefined
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
          }),
        )
      },
    }) as any

    await client.beta.messages.create(
      params({
        output_config: {
          format: {
            type: 'json_schema',
            schema: { type: 'object', properties: { title: { type: 'string' } } },
          },
        },
      }),
    )

    expect(requestBody?.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'response',
        strict: true,
        schema: { type: 'object', properties: { title: { type: 'string' } } },
      },
    })
  })

  test('does not promote an unoffered textual tool call', async () => {
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: { content: 'Tool call Dangerous: {"command":"no"}' },
              },
            ],
          }),
        ),
    }) as any

    const response = await client.beta.messages.create(params())

    expect(response.content).toEqual([
      { type: 'text', text: 'Tool call Dangerous: {"command":"no"}' },
    ])
  })

  test('returns SDK-compatible HTTP errors', async () => {
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async () =>
        new Response(
          JSON.stringify({ error: { message: 'slow down', type: 'rate_limit_error' } }),
          { status: 429, headers: { 'retry-after': '1', 'x-request-id': 'req_1' } },
        ),
    }) as any

    try {
      await client.beta.messages.create(params())
      throw new Error('expected request to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(APIError)
      expect((error as APIError).status).toBe(429)
      expect((error as APIError).headers?.get('retry-after')).toBe('1')
    }
  })

  test('rejects native calls to tools that were not offered', async () => {
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'Dangerous', arguments: '{}' },
                    },
                  ],
                },
              },
            ],
          }),
        ),
    }) as any

    await expect(client.beta.messages.create(params())).rejects.toThrow(
      'unoffered tool Dangerous',
    )
  })

  test('emits parallel streamed tool calls as sequential content blocks', async () => {
    const frames = [
      {
        choices: [
          {
            finish_reason: null,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_read',
                  function: { name: 'Read', arguments: '{"file' },
                },
                {
                  index: 1,
                  id: 'call_bash',
                  function: { name: 'Bash', arguments: '{"command":"pwd"}' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            finish_reason: null,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '_path":"x"}' } },
              ],
            },
          },
        ],
      },
      { choices: [{ finish_reason: 'tool_calls', delta: {} }] },
    ]
    const body = `${frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async () => new Response(body, { status: 200 }),
    }) as any
    const result = await client.beta.messages
      .create(
        params({
          stream: true,
          tools: [
            {
              name: 'Read',
              description: 'Read a file',
              input_schema: { type: 'object' },
            },
            {
              name: 'Bash',
              description: 'Run a command',
              input_schema: { type: 'object' },
            },
          ],
        }),
      )
      .withResponse()
    const events: Array<Record<string, any>> = []
    for await (const event of result.data) events.push(event)

    const blockEvents = events.filter(event =>
      event.type.startsWith('content_block_'),
    )
    expect(blockEvents.map(event => event.type)).toEqual([
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
    ])
    expect(blockEvents.map(event => event.index)).toEqual([0, 0, 0, 1, 1, 1])
    expect(blockEvents[0]?.content_block?.name).toBe('Read')
    expect(blockEvents[1]?.delta?.partial_json).toBe('{"file_path":"x"}')
    expect(blockEvents[3]?.content_block?.name).toBe('Bash')
  })

  test('rejects a stream that ends without a finish reason', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
          ),
        )
        controller.close()
      },
    })
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: async () => new Response(stream, { status: 200 }),
    }) as any
    const result = await client.beta.messages
      .create(params({ stream: true }))
      .withResponse()

    await expect(
      (async () => {
        for await (const _event of result.data) {
          // Consume the full stream.
        }
      })(),
    ).rejects.toThrow('ended before a finish reason')
  })
})
