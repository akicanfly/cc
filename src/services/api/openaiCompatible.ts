import type { ClientOptions } from '@anthropic-ai/sdk'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'

type AnthropicStreamEvent = {
  type: string
  [key: string]: unknown
}

type OpenAIChatTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: unknown
  }
}

type OpenAIToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } }

type OpenAIMessage =
  | { role: 'system'; content: string }
  | {
      role: 'user'
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string } }
          >
    }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

type OpenAIChatRequest = {
  model: string
  stream: boolean
  stream_options?: { include_usage: boolean }
  messages: OpenAIMessage[]
  tools?: OpenAIChatTool[]
  tool_choice?: OpenAIToolChoice
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string[]
}

type OpenAIChatCompletion = {
  id?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  usage?: OpenAIUsage
}

type OpenAIChunk = {
  id?: string
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: OpenAIToolCallDelta[] | null
    } | null
    finish_reason?: string | null
  }>
  usage?: OpenAIUsage | null
}

type OpenAIToolCallDelta = {
  index?: number
  id?: string | null
  type?: string | null
  function?: { name?: string | null; arguments?: string | null } | null
}

type OpenAIUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number } | null
  completion_tokens_details?: { reasoning_tokens?: number } | null
}

type OpenAICompatibleConfig = {
  baseURL: string
  apiKey: string
  headers: Record<string, string>
  timeoutMs: number
}

type ToolAccumulator = {
  blockIndex: number
  id?: string
  name?: string
  arguments: string
  started: boolean
}

export function isOpenAICompatibleEnabled(): boolean {
  return !!getOpenAICompatibleConfig()
}

export async function listOpenAICompatibleModels(): Promise<string[]> {
  const config = requireOpenAICompatibleConfig()
  const response = await globalThis.fetch(
    `${config.baseURL.replace(/\/+$/, '')}/models`,
    {
      method: 'GET',
      headers: {
        ...config.headers,
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    },
  )

  if (!response.ok) {
    throw new Error(
      `OpenAI-compatible models request failed (${response.status}): ${await safeErrorBody(response)}`,
    )
  }

  const parsed = (await response.json()) as { data?: Array<{ id?: string }> }
  return (parsed.data ?? [])
    .map(model => model.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
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
  const config = requireOpenAICompatibleConfig()
  const response = await postOpenAIChatCompletion({
    config,
    params,
    stream: false,
    signal,
    fetchOverride,
  })

  const parsed = (await response.json()) as OpenAIChatCompletion
  const message = parsed.choices?.[0]?.message
  const textualToolCall = parseTextualToolCall(message?.content)
  const content: Array<Record<string, unknown>> = []

  if (textualToolCall && !message?.tool_calls?.length) {
    content.push({
      type: 'tool_use',
      id: `toolu_${randomUUID()}`,
      name: textualToolCall.name,
      input: textualToolCall.input,
    })
  } else {
    if (message?.content) content.push({ type: 'text', text: message.content })
    for (const toolCall of message?.tool_calls ?? []) {
      content.push({
        type: 'tool_use',
        id: toolCall.id ?? `toolu_${randomUUID()}`,
        name: toolCall.function?.name ?? 'tool',
        input: parseToolInput(toolCall.function?.arguments),
      })
    }
  }

  return {
    id: parsed.id ?? `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    content,
    stop_reason:
      textualToolCall && !message?.tool_calls?.length
        ? 'tool_use'
        : mapStopReason(parsed.choices?.[0]?.finish_reason),
    stop_sequence: null,
    usage: toAnthropicUsage(parsed.usage),
    _request_id: response.headers.get('x-request-id') ?? undefined,
  }
}

async function createOpenAICompatibleStream(
  params: BetaMessageStreamParams,
  signal: AbortSignal | undefined,
  fetchOverride: ClientOptions['fetch'] | undefined,
): Promise<{
  data: AsyncIterable<AnthropicStreamEvent> & { controller: AbortController }
  response: Response
  request_id: string | null
}> {
  const config = requireOpenAICompatibleConfig()
  const controller = linkedAbortController(signal)
  const response = await postOpenAIChatCompletion({
    config,
    params,
    stream: true,
    signal: controller.signal,
    fetchOverride,
  })

  if (!response.body) {
    throw new Error('OpenAI-compatible request failed: response body is empty')
  }

  const requestId = response.headers.get('x-request-id')
  return {
    data: fromOpenAIStream(response.body, params.model, controller),
    response,
    request_id: requestId,
  }
}

async function postOpenAIChatCompletion({
  config,
  params,
  stream,
  signal,
  fetchOverride,
}: {
  config: OpenAICompatibleConfig
  params: BetaMessageStreamParams
  stream: boolean
  signal: AbortSignal | undefined
  fetchOverride: ClientOptions['fetch'] | undefined
}): Promise<Response> {
  const timeout = timeoutSignal(config.timeoutMs)
  const controller = linkedAbortController(signal)
  const abortTimeout = () => controller.abort(timeout.reason)
  timeout.addEventListener('abort', abortTimeout, { once: true })

  try {
    const response = await (fetchOverride ?? globalThis.fetch)(
      `${config.baseURL.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          ...config.headers,
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(toOpenAIRequest(params, stream)),
      },
    )

    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible request failed (${response.status}): ${await safeErrorBody(response)}`,
      )
    }
    return response
  } finally {
    timeout.removeEventListener('abort', abortTimeout)
  }
}

function getOpenAICompatibleConfig(): OpenAICompatibleConfig | undefined {
  const baseURL = (process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.OPENAI_BASE_URL)?.trim()
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY
  if (!baseURL || !apiKey) return undefined

  try {
    new URL(baseURL)
  } catch {
    throw new Error('OpenAI-compatible provider requires a valid OPENAI_COMPATIBLE_BASE_URL or OPENAI_BASE_URL')
  }

  return {
    baseURL,
    apiKey,
    headers: parseHeaders(process.env.OPENAI_COMPATIBLE_HEADERS),
    timeoutMs: parseInt(process.env.OPENAI_COMPATIBLE_TIMEOUT_MS || process.env.API_TIMEOUT_MS || String(600_000), 10),
  }
}

function requireOpenAICompatibleConfig(): OpenAICompatibleConfig {
  const config = getOpenAICompatibleConfig()
  if (!config) {
    throw new Error('OpenAI-compatible provider requires OPENAI_COMPATIBLE_BASE_URL or OPENAI_BASE_URL and an API key')
  }
  return config
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    throw new Error('OPENAI_COMPATIBLE_HEADERS must be valid JSON object with string values')
  }
}

function toOpenAIRequest(params: BetaMessageStreamParams, stream: boolean): OpenAIChatRequest {
  const toolChoice = toOpenAIToolChoice(params.tool_choice)
  return {
    model: params.model,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    messages: [
      ...systemMessages(params.system),
      ...params.messages.flatMap(message => toOpenAIMessages(message)),
    ],
    ...(params.tools?.length ? { tools: params.tools.map(toOpenAITool) } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(params.max_tokens !== undefined ? { max_tokens: params.max_tokens } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.top_p !== undefined ? { top_p: params.top_p } : {}),
    ...(params.stop_sequences?.length ? { stop: params.stop_sequences } : {}),
  }
}

function toOpenAITool(tool: NonNullable<BetaMessageStreamParams['tools']>[number]): OpenAIChatTool {
  const customTool = tool as { name: string; description?: string; input_schema: unknown }
  return {
    type: 'function',
    function: {
      name: customTool.name,
      description: customTool.description,
      parameters: customTool.input_schema,
    },
  }
}

function toOpenAIToolChoice(toolChoice: BetaMessageStreamParams['tool_choice']): OpenAIToolChoice | undefined {
  if (!toolChoice) return undefined
  if (toolChoice.type === 'auto') return 'auto'
  if (toolChoice.type === 'none') return 'none'
  if (toolChoice.type === 'any') return 'required'
  if (toolChoice.type === 'tool') return { type: 'function', function: { name: toolChoice.name } }
  return undefined
}

function systemMessages(system: BetaMessageStreamParams['system']): OpenAIMessage[] {
  if (!system) return []
  if (typeof system === 'string') return [{ role: 'system', content: system }]
  const text = system.map(block => ('text' in block ? block.text : '')).filter(Boolean).join('\n')
  return text ? [{ role: 'system', content: text }] : []
}

function toOpenAIMessages(message: BetaMessageStreamParams['messages'][number]): OpenAIMessage[] {
  if (typeof message.content === 'string') return [{ role: message.role, content: message.content }]

  if (message.role === 'assistant') {
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    const toolCalls = message.content.filter(block => block.type === 'tool_use').map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: stringifyJson(block.input ?? {}) },
    }))
    return [{ role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }]
  }

  const messages: OpenAIMessage[] = []
  const contentParts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
  for (const block of message.content) {
    if (block.type === 'text') contentParts.push({ type: 'text', text: block.text })
    if (block.type === 'image') {
      contentParts.push({
        type: 'image_url',
        image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
      })
    }
  }
  if (contentParts.length === 1 && contentParts[0]?.type === 'text') {
    messages.push({ role: 'user', content: contentParts[0].text })
  } else if (contentParts.length) {
    messages.push({ role: 'user', content: contentParts })
  }

  for (const block of message.content) {
    if (block.type !== 'tool_result') continue
    messages.push({
      role: 'tool',
      tool_call_id: block.tool_use_id,
      content: toolResultContent(block.content),
    })
  }

  return messages.length ? messages : [{ role: 'user', content: '' }]
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
        usage: toAnthropicUsage(),
      },
    }

    let nextBlockIndex = 0
    let textBlockIndex: number | undefined
    let textualToolCandidate = ''
    let stopReason: string | null = null
    let usage = toAnthropicUsage()
    const tools = new Map<number, ToolAccumulator>()

    for await (const frame of readSSE(body)) {
      const parsed = parseOpenAIChunk(frame)
      if (parsed.usage) usage = toAnthropicUsage(parsed.usage)
      const choice = parsed.choices?.[0]
      if (choice?.finish_reason) stopReason = mapStopReason(choice.finish_reason)
      const delta = choice?.delta
      if (!delta) continue

      if (delta.content) {
        const candidate = textualToolCandidate + delta.content
        if (textBlockIndex === undefined && tools.size === 0 && isPotentialTextualToolCall(candidate)) {
          textualToolCandidate = candidate
        } else {
          if (textualToolCandidate) {
            textBlockIndex = yield* yieldTextDelta(textualToolCandidate, textBlockIndex, nextBlockIndex)
            if (textBlockIndex === nextBlockIndex) nextBlockIndex += 1
            textualToolCandidate = ''
          }
          const previousIndex = textBlockIndex
          textBlockIndex = yield* yieldTextDelta(delta.content, textBlockIndex, nextBlockIndex)
          if (previousIndex === undefined) nextBlockIndex += 1
        }
      }

      for (const toolDelta of delta.tool_calls ?? []) {
        const events = appendToolDelta(tools, toolDelta, nextBlockIndex)
        if (events.started) nextBlockIndex += 1
        for (const event of events.events) yield event
      }
    }

    const textualToolCall = tools.size === 0 ? parseTextualToolCall(textualToolCandidate) : null
    if (textualToolCall) {
      yield {
        type: 'content_block_start',
        index: nextBlockIndex,
        content_block: { type: 'tool_use', id: `toolu_${randomUUID()}`, name: textualToolCall.name, input: {} },
      }
      yield {
        type: 'content_block_delta',
        index: nextBlockIndex,
        delta: { type: 'input_json_delta', partial_json: stringifyJson(textualToolCall.input) },
      }
      yield { type: 'content_block_stop', index: nextBlockIndex }
      stopReason = 'tool_use'
    } else if (textualToolCandidate) {
      const previousIndex = textBlockIndex
      textBlockIndex = yield* yieldTextDelta(textualToolCandidate, textBlockIndex, nextBlockIndex)
      if (previousIndex === undefined) nextBlockIndex += 1
    }

    if (textBlockIndex !== undefined) yield { type: 'content_block_stop', index: textBlockIndex }
    for (const tool of tools.values()) {
      if (tool.started) yield { type: 'content_block_stop', index: tool.blockIndex }
    }
    yield {
      type: 'message_delta',
      delta: { stop_reason: stopReason ?? 'end_turn', stop_sequence: null },
      usage,
    }
    yield { type: 'message_stop' }
  })() as unknown as AsyncIterable<AnthropicStreamEvent> & { controller: AbortController }
  stream.controller = controller
  return stream
}

function* yieldTextDelta(
  text: string,
  existingIndex: number | undefined,
  nextBlockIndex: number,
): Generator<AnthropicStreamEvent, number> {
  const index = existingIndex ?? nextBlockIndex
  if (existingIndex === undefined) {
    yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
  }
  yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }
  return index
}

function appendToolDelta(
  tools: Map<number, ToolAccumulator>,
  delta: OpenAIToolCallDelta,
  nextBlockIndex: number,
): { started: boolean; events: AnthropicStreamEvent[] } {
  const openAIIndex = delta.index ?? 0
  let tool = tools.get(openAIIndex)
  let started = false
  if (!tool) {
    tool = { blockIndex: nextBlockIndex, arguments: '', started: false }
    tools.set(openAIIndex, tool)
  }
  if (delta.id) tool.id = delta.id
  if (delta.function?.name) tool.name = delta.function.name

  const args = delta.function?.arguments
  const previousArguments = tool.arguments
  if (args) tool.arguments += args

  const events: AnthropicStreamEvent[] = []
  if (!tool.started && tool.name) {
    tool.started = true
    started = true
    events.push({
      type: 'content_block_start',
      index: tool.blockIndex,
      content_block: { type: 'tool_use', id: tool.id ?? `toolu_${randomUUID()}`, name: tool.name, input: {} },
    })
    if (previousArguments) {
      events.push({
        type: 'content_block_delta',
        index: tool.blockIndex,
        delta: { type: 'input_json_delta', partial_json: previousArguments },
      })
    }
  }

  if (args && tool.started) {
    events.push({
      type: 'content_block_delta',
      index: tool.blockIndex,
      delta: { type: 'input_json_delta', partial_json: args },
    })
  }
  return { started, events }
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
      yield* drainSSEBuffer(buffer, nextSSEBoundary(buffer))
      buffer = remainingSSEBuffer(buffer)
    }
    buffer += decoder.decode()
    if (buffer.trim()) yield* parseSSEEvent(buffer)
  } finally {
    reader.releaseLock()
  }
}

function* drainSSEBuffer(buffer: string, boundary: { index: number; length: number } | null): Generator<string> {
  let current = buffer
  let found = boundary
  while (found) {
    yield* parseSSEEvent(current.slice(0, found.index))
    current = current.slice(found.index + found.length)
    found = nextSSEBoundary(current)
  }
}

function remainingSSEBuffer(buffer: string): string {
  let current = buffer
  let found = nextSSEBoundary(current)
  while (found) {
    current = current.slice(found.index + found.length)
    found = nextSSEBoundary(current)
  }
  return current
}

function nextSSEBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (lf === -1) return { index: crlf, length: 4 }
  if (crlf === -1) return { index: lf, length: 2 }
  return crlf < lf ? { index: crlf, length: 4 } : { index: lf, length: 2 }
}

function* parseSSEEvent(event: string): Generator<string> {
  const data = event
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
    .trim()
  if (data && data !== '[DONE]') yield data
}

function parseOpenAIChunk(frame: string): OpenAIChunk {
  try {
    return JSON.parse(frame) as OpenAIChunk
  } catch (error) {
    throw new Error(`OpenAI-compatible stream returned invalid JSON chunk: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function mapStopReason(reason: string | null | undefined): string {
  if (reason === 'length') return 'max_tokens'
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use'
  if (reason === 'content_filter') return 'stop_sequence'
  return 'end_turn'
}

function toAnthropicUsage(usage?: OpenAIUsage | null) {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
    cache_read_input_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
    cache_creation_input_tokens: 0,
  }
}

function parseToolInput(input: string | undefined): unknown {
  if (!input) return {}
  try {
    return JSON.parse(input) as unknown
  } catch {
    return {}
  }
}

function toolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item) {
          return String(item.text)
        }
        return stringifyJson(item)
      })
      .join('\n')
  }
  return stringifyJson(content ?? '')
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isPotentialTextualToolCall(text: string): boolean {
  const trimmed = text.trimStart()
  return 'Tool call'.startsWith(trimmed) || trimmed.startsWith('Tool call')
}

function parseTextualToolCall(text: string | null | undefined): { name: string; input: unknown } | null {
  if (!text) return null
  const match = text.trim().match(/^Tool call\s+([A-Za-z0-9_-]+):\s*([\s\S]+)$/)
  if (!match) return null
  try {
    return { name: match[1]!, input: JSON.parse(match[2]!.trim()) as unknown }
  } catch {
    return null
  }
}

function linkedAbortController(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController()
  if (!signal) return controller
  if (signal.aborted) controller.abort(signal.reason)
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  return controller
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(timeoutMs)
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('OpenAI-compatible request timed out')), timeoutMs).unref?.()
  return controller.signal
}

async function safeErrorBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => response.statusText)
  const sanitized = text.trim() || response.statusText
  return sanitized.length > 1_000 ? `${sanitized.slice(0, 1_000)}…` : sanitized
}
