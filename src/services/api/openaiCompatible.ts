import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ClientOptions } from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'

type AnthropicStreamEvent = {
  type: string
  [key: string]: unknown
}

type OpenAIChunk = {
  id?: string
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export function isOpenAICompatibleEnabled(): boolean {
  return !!getOpenAICompatibleConfig()
}

export function createOpenAICompatibleAnthropicClient({
  fetchOverride,
}: {
  fetchOverride?: ClientOptions['fetch']
}): unknown {
  return {
    beta: {
      messages: {
        create(params: BetaMessageStreamParams, options?: { signal?: AbortSignal }) {
          if (!params.stream) {
            return createOpenAICompatibleMessage(params, options?.signal, fetchOverride)
          }
          return {
            withResponse: () =>
              createOpenAICompatibleStream(params, options?.signal, fetchOverride),
          }
        },
      },
    },
  }
}

async function createOpenAICompatibleMessage(
  params: BetaMessageStreamParams,
  signal: AbortSignal | undefined,
  fetchOverride: ClientOptions['fetch'] | undefined,
): Promise<Record<string, unknown>> {
  const config = getOpenAICompatibleConfig()
  if (!config) {
    throw new Error('OpenAI-compatible provider requires OPENAI_COMPATIBLE_BASE_URL or OPENAI_BASE_URL and an API key')
  }

  const response = await (fetchOverride ?? globalThis.fetch)(
    `${config.baseURL.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({ ...toOpenAIRequest(params), stream: false }),
    },
  )

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI-compatible request failed (${response.status}): ${body || response.statusText}`)
  }

  const parsed = (await response.json()) as OpenAIChunk & {
    choices?: Array<{
      message?: {
        content?: string | null
        tool_calls?: Array<{
          id?: string
          type?: string
          function?: { name?: string; arguments?: string }
        }>
      }
    }>
  }
  const message = parsed.choices?.[0]?.message
  const content: Array<Record<string, unknown>> = []
  if (message?.content) {
    content.push({ type: 'text', text: message.content })
  }
  for (const toolCall of message?.tool_calls ?? []) {
    content.push({
      type: 'tool_use',
      id: toolCall.id ?? `toolu_${randomUUID()}`,
      name: toolCall.function?.name ?? 'tool',
      input: parseToolInput(toolCall.function?.arguments),
    })
  }

  return {
    id: parsed.id ?? `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    content,
    stop_reason: mapStopReason(parsed.choices?.[0]?.finish_reason ?? 'stop'),
    stop_sequence: null,
    usage: {
      input_tokens: parsed.usage?.prompt_tokens ?? 0,
      output_tokens: parsed.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    _request_id: response.headers.get('x-request-id') ?? undefined,
  }
}

async function createOpenAICompatibleStream(
  params: BetaMessageStreamParams,
  signal: AbortSignal | undefined,
  fetchOverride: ClientOptions['fetch'] | undefined,
): Promise<{ data: AsyncIterable<AnthropicStreamEvent> & { controller: AbortController }; response: Response; request_id: string | null }> {
  const config = getOpenAICompatibleConfig()
  if (!config) {
    throw new Error('OpenAI-compatible provider requires OPENAI_COMPATIBLE_BASE_URL or OPENAI_BASE_URL and an API key')
  }

  const controller = new AbortController()
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }

  const response = await (fetchOverride ?? globalThis.fetch)(
    `${config.baseURL.replace(/\/$/, '')}/chat/completions`,
    {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify(toOpenAIRequest(params)),
    },
  )

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '')
    throw new Error(`OpenAI-compatible request failed (${response.status}): ${body || response.statusText}`)
  }

  const requestId = response.headers.get('x-request-id')
  const data = fromOpenAIStream(response.body, params.model, controller)
  return { data, response, request_id: requestId }
}

function getOpenAICompatibleConfig(): { baseURL: string; apiKey: string; headers: Record<string, string> } | undefined {
  const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.OPENAI_BASE_URL
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY
  if (!baseURL || !apiKey) return undefined
  return {
    baseURL,
    apiKey,
    headers: parseHeaders(process.env.OPENAI_COMPATIBLE_HEADERS),
  }
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    }
  } catch {}
  return {}
}

function toOpenAIRequest(params: BetaMessageStreamParams): Record<string, unknown> {
  return {
    model: params.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      ...systemMessages(params.system),
      ...params.messages.map(message => ({
        role: message.role,
        content: contentToText(message.content),
      })),
    ],
    ...(params.max_tokens ? { max_tokens: params.max_tokens } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.tools?.length
      ? {
          tools: params.tools.map(tool => {
            const customTool = tool as {
              name: string
              description?: string
              input_schema: unknown
            }
            return {
              type: 'function',
              function: {
                name: customTool.name,
                description: customTool.description,
                parameters: customTool.input_schema,
              },
            }
          }),
        }
      : {}),
  }
}

function systemMessages(system: BetaMessageStreamParams['system']): Array<{ role: 'system'; content: string }> {
  if (!system) return []
  if (typeof system === 'string') return [{ role: 'system', content: system }]
  return [{ role: 'system', content: system.map(block => ('text' in block ? block.text : '')).join('\n') }]
}

function contentToText(content: BetaMessageStreamParams['messages'][number]['content']): string {
  if (typeof content === 'string') return content
  return content
    .map(block => {
      if (block.type === 'text') return block.text
      if (block.type === 'tool_result') return typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
      if (block.type === 'tool_use') return `Tool call ${block.name}: ${JSON.stringify(block.input)}`
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function fromOpenAIStream(
  body: ReadableStream<Uint8Array>,
  model: string,
  controller: AbortController,
): AsyncIterable<AnthropicStreamEvent> & { controller: AbortController } {
  const stream = (async function* () {
    const messageId = `msg_${randomUUID()}`
    yield {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }

    let textStarted = false
    const toolIndexes = new Map<number, number>()
    let nextBlockIndex = 0
    let stopReason: string | null = null
    let inputTokens = 0
    let outputTokens = 0

    for await (const chunk of readSSE(body)) {
      if (chunk === '[DONE]') break
      const parsed = JSON.parse(chunk) as OpenAIChunk
      const choice = parsed.choices?.[0]
      if (parsed.usage) {
        inputTokens = parsed.usage.prompt_tokens ?? inputTokens
        outputTokens = parsed.usage.completion_tokens ?? outputTokens
      }
      if (choice?.finish_reason) stopReason = mapStopReason(choice.finish_reason)

      const content = choice?.delta?.content
      if (content) {
        if (!textStarted) {
          textStarted = true
          yield { type: 'content_block_start', index: nextBlockIndex, content_block: { type: 'text', text: '' } }
        }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } }
      }

      for (const toolCall of choice?.delta?.tool_calls ?? []) {
        const toolCallIndex = toolCall.index ?? 0
        let blockIndex = toolIndexes.get(toolCallIndex)
        if (blockIndex === undefined) {
          blockIndex = textStarted ? ++nextBlockIndex : nextBlockIndex
          nextBlockIndex = blockIndex
          toolIndexes.set(toolCallIndex, blockIndex)
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: {
              type: 'tool_use',
              id: toolCall.id ?? `toolu_${randomUUID()}`,
              name: toolCall.function?.name ?? 'tool',
              input: {},
            },
          }
        }
        const args = toolCall.function?.arguments
        if (args) {
          yield { type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: args } }
        }
      }
    }

    if (textStarted) yield { type: 'content_block_stop', index: 0 }
    for (const blockIndex of toolIndexes.values()) yield { type: 'content_block_stop', index: blockIndex }
    yield {
      type: 'message_delta',
      delta: { stop_reason: stopReason ?? 'end_turn', stop_sequence: null },
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }
    yield { type: 'message_stop' }
  })() as unknown as AsyncIterable<AnthropicStreamEvent> & { controller: AbortController }
  stream.controller = controller
  return stream
}

async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = event
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .join('\n')
        if (data) yield data
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function mapStopReason(reason: string): string {
  if (reason === 'length') return 'max_tokens'
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'content_filter') return 'stop_sequence'
  return 'end_turn'
}

function parseToolInput(input: string | undefined): unknown {
  if (!input) return {}
  try {
    return JSON.parse(input) as unknown
  } catch {
    return {}
  }
}
