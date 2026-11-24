import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createOpenAICompatibleAnthropicClient } from './openaiCompatible.js'
import {
  createResponsesMessage,
  toResponsesRequest,
} from './openaiCompatibleResponses.js'
import { resetZenRunSessionId } from './openaiCompatibleQuirks.js'

const originalEnv = { ...process.env }
const FREE_MODEL = 'muse-spark-1.3-contributor-free'

function zenEnv() {
  process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://opencode.ai/zen/v1'
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_COMPATIBLE_API_KEY
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_COMPATIBLE_HEADERS
  delete process.env.OPENAI_COMPATIBLE_USE_RESPONSES
}

beforeEach(() => {
  zenEnv()
  resetZenRunSessionId()
})

afterEach(() => {
  process.env = { ...originalEnv }
  resetZenRunSessionId()
})

function params(overrides: Record<string, unknown> = {}) {
  return {
    model: FREE_MODEL,
    max_tokens: 64,
    messages: [{ role: 'user', content: 'hello' }],
    stream: false,
    ...overrides,
  }
}

describe('toResponsesRequest', () => {
  test.each([false, true])('omits reasoning settings with stream=%s', stream => {
    const body = toResponsesRequest(
      params({ output_config: { effort: 'high' } }) as never,
      stream,
    )

    expect(body).not.toHaveProperty('reasoning')
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  test('maps system to instructions and text messages to input', () => {
    const body = toResponsesRequest(
      params({ system: 'be brief' }) as never,
      false,
    )
    expect(body.model).toBe(FREE_MODEL)
    expect(body.instructions).toBe('be brief')
    expect(body.input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    ])
    expect(body.max_output_tokens).toBe(64)
    expect(body.stream).toBe(false)
  })

  test('maps images, tool results, and assistant tool calls', () => {
    const body = toResponsesRequest(
      params({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              {
                type: 'image',
                source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
              },
              {
                type: 'tool_result',
                tool_use_id: 'call_1',
                content: [{ type: 'text', text: 'out' }],
              },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'working' },
              { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { p: 'x' } },
            ],
          },
        ],
        tools: [{ name: 'Read', description: 'read', input_schema: { type: 'object' } }],
        tool_choice: { type: 'any' },
      }) as never,
      false,
    )
    expect(body.input[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'look' },
        { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=', detail: 'auto' },
      ],
    })
    expect(body.input[1]).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: 'out',
    })
    expect(body.input[2]).toEqual({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'working' }],
    })
    expect(body.input[3]).toEqual({
      type: 'function_call',
      call_id: 'toolu_1',
      name: 'Read',
      arguments: '{"p":"x"}',
    })
    expect(body.tools).toEqual([
      { type: 'function', name: 'Read', description: 'read', parameters: { type: 'object' }, strict: false },
    ])
    expect(body.tool_choice).toBe('required')
  })

  test('uses output_text parts on assistant history', () => {
    const body = toResponsesRequest(
      params({
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello back' },
          { role: 'user', content: 'again' },
        ],
      }) as never,
      true,
    )
    expect(body.input[1]).toEqual({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'hello back' }],
    })
  })

  test('maps image urls and json schema output', () => {
    const body = toResponsesRequest(
      params({
        messages: [
          {
            role: 'user',
            content: [{ type: 'image', source: { type: 'url', url: 'https://x.test/i.png' } }],
          },
        ],
        output_config: {
          format: { type: 'json_schema', schema: { type: 'object' } },
        },
      }) as never,
      false,
    )
    expect(body.input[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_image', image_url: 'https://x.test/i.png', detail: 'auto' }],
    })
    expect(body.text).toEqual({
      format: { type: 'json_schema', name: 'response', strict: true, schema: { type: 'object' } },
    })
  })
})

describe('createResponsesMessage', () => {
  test('reads text and usage from output items', () => {
    const message = createResponsesMessage(
      {
        id: 'resp_1',
        status: 'completed',
        output: [
          { type: 'reasoning', status: 'completed', encrypted_content: 'opaque' },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hi there' }],
          },
        ],
        usage: { input_tokens: 13, output_tokens: 9 },
      },
      params() as never,
      'req_1',
    )
    expect(message.content).toEqual([expect.objectContaining({ type: 'thinking', signature: expect.stringContaining('opaque') }), { type: 'text', text: 'Hi there' }])
    expect(message.stop_reason).toBe('end_turn')
    expect(message.usage).toEqual({
      input_tokens: 13,
      output_tokens: 9,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })
    expect(message._request_id).toBe('req_1')
  })

  test('maps function calls to tool_use with validation', () => {
    const message = createResponsesMessage(
      {
        id: 'resp_2',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            call_id: 'call_9',
            name: 'Read',
            arguments: '{"p":"x"}',
          },
        ],
      },
      params({
        tools: [{ name: 'Read', description: 'r', input_schema: { type: 'object' } }],
      }) as never,
      null,
    )
    expect(message.content).toEqual([
      { type: 'tool_use', id: 'call_9', name: 'Read', input: { p: 'x' } },
    ])
    expect(message.stop_reason).toBe('tool_use')
  })
})

describe('Responses adapter routing', () => {
  test('posts the free model to /responses with a session header', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    let body: Record<string, any> = {}
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: (async (input: unknown, init?: { headers?: unknown; body?: unknown }) => {
        url = String(input)
        headers = Object.fromEntries(new Headers(init?.headers as HeadersInit).entries())
        body = JSON.parse(String(init?.body))
        return new Response(
          JSON.stringify({
            id: 'resp_1',
            status: 'completed',
            output: [
              { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        )
      }) as never,
    }) as any

    const response = await client.beta.messages.create(params())
    expect(url).toBe('https://opencode.ai/zen/v1/responses')
    expect(headers['x-opencode-session']).toMatch(/^ses_/)
    expect(body.model).toBe(FREE_MODEL)
    expect(Array.isArray(body.input)).toBe(true)
    expect(response.content).toEqual([{ type: 'text', text: 'ok' }])
  })

  test('keeps other models on /chat/completions', async () => {
    let url = ''
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: (async (input: unknown) => {
        url = String(input)
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
          }),
        )
      }) as never,
    }) as any

    await client.beta.messages.create(params({ model: 'muse-spark-1.3' }))
    expect(url).toBe('https://opencode.ai/zen/v1/chat/completions')
  })

  test('streams response text deltas as Anthropic events', async () => {
    const frames = [
      { type: 'response.created', response: { id: 'resp_s' } },
      { type: 'response.output_text.delta', output_index: 0, delta: 'Hi' },
      { type: 'response.output_text.delta', output_index: 0, delta: ' there' },
      {
        type: 'response.completed',
        response: {
          id: 'resp_s',
          status: 'completed',
          usage: { input_tokens: 2, output_tokens: 3 },
        },
      },
    ]
    const sse = `${frames.map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('')}`
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: (async () => new Response(sse, { status: 200 })) as never,
    }) as any

    const result = await client.beta.messages
      .create(params({ stream: true }))
      .withResponse()
    const events: Array<Record<string, any>> = []
    for await (const event of result.data) events.push(event)

    expect(events[0]?.type).toBe('message_start')
    const deltas = events.filter(
      event => event.type === 'content_block_delta' && event.delta?.type === 'text_delta',
    )
    expect(deltas.map(event => event.delta.text).join('')).toBe('Hi there')
    expect(events.at(-2)).toMatchObject({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
    })
    expect(events.at(-1)?.type).toBe('message_stop')
  })

  test('streams function calls as sequential tool blocks', async () => {
    const frames = [
      {
        type: 'response.output_item.added',
        output_index: 1,
        item: { type: 'function_call', call_id: 'call_r', name: 'Read' },
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 1,
        delta: '{"p":"x"}',
      },
      {
        type: 'response.output_item.done',
        output_index: 1,
        item: { type: 'function_call', call_id: 'call_r', name: 'Read', arguments: '{"p":"x"}' },
      },
      { type: 'response.completed', response: { id: 'resp_t', status: 'completed' } },
    ]
    const sse = `${frames.map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('')}`
    const client = createOpenAICompatibleAnthropicClient({
      fetchOverride: (async () => new Response(sse, { status: 200 })) as never,
    }) as any

    const result = await client.beta.messages
      .create(
        params({
          stream: true,
          tools: [{ name: 'Read', description: 'r', input_schema: { type: 'object' } }],
        }),
      )
      .withResponse()
    const events: Array<Record<string, any>> = []
    for await (const event of result.data) events.push(event)

    const starts = events.filter(event => event.type === 'content_block_start')
    expect(starts).toHaveLength(1)
    expect(starts[0]?.content_block).toMatchObject({ type: 'tool_use', name: 'Read', id: 'call_r' })
    expect(events.at(-2)).toMatchObject({ delta: { stop_reason: 'tool_use' } })
  })
})

describe('Responses reasoning and mixed output', () => {
  test('preserves encrypted reasoning and output order in a non-streaming tool round trip', () => {
    const request = params({ tools: [{ name: 'Read', input_schema: { type: 'object' } }] }) as never
    const message = createResponsesMessage({ output: [
      { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque', summary: [{ type: 'summary_text', text: 'reason' }] },
      { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{}' },
      { type: 'message', content: [{ type: 'output_text', text: 'after' }] },
    ] }, request, null)
    expect((message.content as any[]).map(block => block.type)).toEqual(['thinking', 'tool_use', 'text'])
    const replay = toResponsesRequest(params({ messages: [{ role: 'assistant', content: message.content }] }) as never, false)
    expect(replay.input[0]).toEqual({ type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque', summary: [{ type: 'summary_text', text: 'reason' }] })
    expect(replay.input[1]).toMatchObject({ type: 'function_call', call_id: 'call_1' })
    expect(replay.store).toBe(false)
    expect(replay.include).toContain('reasoning.encrypted_content')
    expect(replay).not.toHaveProperty('reasoning')
  })

  test('handles CRLF streams with reasoning, tools, and text without duplicate done events', async () => {
    const frames = [
      { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [] } },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'reason' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'reason' }], encrypted_content: 'opaque' } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'Read', arguments: '' } },
      { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{}' },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{}' } },
      { type: 'response.output_text.delta', output_index: 2, delta: 'after' },
      { type: 'response.output_text.done', output_index: 2, text: 'after' },
      { type: 'response.output_item.done', output_index: 2, item: { type: 'message', content: [{ type: 'output_text', text: 'after' }] } },
      { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 4 }, output_tokens: 3 } } },
    ]
    const client = createOpenAICompatibleAnthropicClient({ fetchOverride: async () => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join('')) }) as any
    const { data } = await client.beta.messages.create(params({ stream: true, tools: [{ name: 'Read', input_schema: { type: 'object' } }] })).withResponse()
    const events: any[] = []
    for await (const event of data) events.push(event)
    expect(events.filter(e => e.type === 'content_block_start').map(e => e.content_block.type)).toEqual(['thinking', 'tool_use', 'text'])
    expect(events.filter(e => e.delta?.type === 'text_delta').map(e => e.delta.text).join('')).toBe('after')
    expect(events.find(e => e.delta?.type === 'signature_delta').delta.signature).toContain('opaque')
    expect(events.find(e => e.type === 'message_delta').usage.cache_read_input_tokens).toBe(4)
    const open = new Set<number>()
    for (const event of events) {
      if (event.type === 'content_block_start') { expect(open.size).toBe(0); open.add(event.index) }
      if (event.type === 'content_block_stop') expect(open.delete(event.index)).toBe(true)
    }
    expect(open.size).toBe(0)
  })

  test('does not replay failed streams and retains their error classification', async () => {
    let attempts = 0
    const client = createOpenAICompatibleAnthropicClient({ fetchOverride: async () => {
      attempts++
      return new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: {"type":"response.failed","response":{"error":{"code":"invalid_api_key","message":"bad key"}}}\n\n')
    } }) as any
    const { data } = await client.beta.messages.create(params({ stream: true })).withResponse()
    await expect((async () => { for await (const _event of data) { /* drain */ } })()).rejects.toMatchObject({ status: 401 })
    expect(attempts).toBe(1)
  })
})

describe('Responses wire variants', () => {
  test('accepts JSON responses when a provider ignores stream=true', async () => {
    const client = createOpenAICompatibleAnthropicClient({ fetchOverride: async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'whole answer' }] }] }) }) as any
    const { data } = await client.beta.messages.create(params({ stream: true })).withResponse()
    const events: any[] = []
    for await (const event of data) events.push(event)
    expect(events.filter(e => e.delta?.type === 'text_delta').map(e => e.delta.text).join('')).toBe('whole answer')
    expect(events.at(-1).type).toBe('message_stop')
  })
  test('retains the textual tool-call fallback without emitting it as ordinary text', async () => {
    const frames = [
      { type: 'response.output_text.delta', delta: 'Tool call Read: ' },
      { type: 'response.output_text.delta', delta: '{"file_path":"example"}' },
      { type: 'response.completed', response: { status: 'completed' } },
    ]
    const client = createOpenAICompatibleAnthropicClient({ fetchOverride: async () => new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')) }) as any
    const { data } = await client.beta.messages.create(params({ stream: true, tools: [{ name: 'Read', input_schema: { type: 'object' } }] })).withResponse()
    const events: any[] = []
    for await (const event of data) events.push(event)
    expect(events.filter(e => e.type === 'content_block_start').map(e => e.content_block.type)).toEqual(['tool_use'])
    expect(events.find(e => e.delta?.type === 'input_json_delta').delta.partial_json).toBe('{"file_path":"example"}')
  })
})
