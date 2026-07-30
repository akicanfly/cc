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
