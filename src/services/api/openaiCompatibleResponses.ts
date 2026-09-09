import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import { getVariantBlob } from 'src/utils/effort/modelVariants.js'
import { isVariantID } from 'src/utils/effort/variantTypes.js'
import type { VariantBlob } from 'src/utils/effort/variantTypes.js'
import { shouldSendOpenAISamplingParams } from './openaiCompatibleQuirks.js'

export type AnthropicStreamEvent = {
  type: string
  [key: string]: unknown
}

type ResponsesTool = {
  type: 'function'
  name: string
  description?: string
  parameters: unknown
  strict: boolean
}

type ResponsesToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; name: string }

type ResponsesContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'output_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'auto' }

type ResponsesInputItem =
  | { type: 'message'; role: 'user' | 'assistant' | 'system' | 'developer'; content: ResponsesContentPart[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }

export type ResponsesRequest = {
  model: string
  input: ResponsesInputItem[]
  stream: boolean
  instructions?: string
  tools?: ResponsesTool[]
  tool_choice?: ResponsesToolChoice
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  reasoning?: { effort: string }
  text?: {
    format: { type: 'json_schema'; name: string; strict: boolean; schema: unknown }
  }
}

type ResponsesOutputItem = {
  type?: string | null
  id?: string | null
  call_id?: string | null
  name?: string | null
  arguments?: string | null
  output?: unknown
  role?: string | null
  status?: string | null
  content?: Array<{
    type?: string | null
    text?: string | null
    refusal?: string | null
  }> | null
  summary?: Array<{ type?: string | null; text?: string | null }> | null
  [key: string]: unknown
}

export type ResponsesResponse = {
  id?: string
  status?: string | null
  model?: string
  output?: ResponsesOutputItem[] | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  } | null
  error?: { message?: unknown; code?: unknown } | null
  incomplete_details?: { reason?: string | null } | null
  [key: string]: unknown
}

type ResponsesStreamEvent = {
  type?: string | null
  output_index?: number
  content_index?: number
  delta?: unknown
  text?: unknown
  arguments?: unknown
  item?: ResponsesOutputItem | null
  part?: { type?: string | null; text?: string | null } | null
  response?: ResponsesResponse | null
  [key: string]: unknown
}

type ToolAccumulator = {
  blockIndex: number
  id?: string
  name?: string
  arguments: string
}

export function toResponsesRequest(
  params: BetaMessageStreamParams,
  stream: boolean,
): ResponsesRequest {
  const requestedEffort = params.output_config?.effort
  const variantBlob =
    typeof requestedEffort === 'string' && isVariantID(requestedEffort)
      ? getVariantBlob(params.model, requestedEffort)
      : undefined
  const sendSamplingParams = shouldSendOpenAISamplingParams(params.model)
  const tools = params.tools?.length
    ? params.tools.map(toResponsesTool)
    : undefined
  const reasoningEffort = extractReasoningEffort(variantBlob)
  const tokenLimit = params.max_tokens
  const responseFormat = toResponsesTextFormat(params.output_config?.format)

  return {
    model: params.model,
    input: toResponsesInput(params.messages),
    stream,
    ...instructionsOf(params.system),
    ...(tools ? { tools } : {}),
    ...(toResponsesToolChoice(params.tool_choice) ?? {}),
    ...(tokenLimit !== undefined ? { max_output_tokens: tokenLimit } : {}),
    ...(sendSamplingParams && params.temperature !== undefined
      ? { temperature: params.temperature }
      : {}),
    ...(sendSamplingParams && params.top_p !== undefined ? { top_p: params.top_p } : {}),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(responseFormat ? { text: responseFormat } : {}),
  }
}

function instructionsOf(
  system: BetaMessageStreamParams['system'],
): Pick<ResponsesRequest, 'instructions'> {
  if (!system) return {}
  if (typeof system === 'string') {
    return system ? { instructions: system } : {}
  }
  const text = system
    .map(block => ('text' in block ? block.text : ''))
    .filter(Boolean)
    .join('\n')
  return text ? { instructions: text } : {}
}

function toResponsesToolChoice(
  toolChoice: BetaMessageStreamParams['tool_choice'],
): Pick<ResponsesRequest, 'tool_choice'> | undefined {
  if (!toolChoice) return undefined
  if (toolChoice.type === 'auto') return { tool_choice: 'auto' }
  if (toolChoice.type === 'none') return { tool_choice: 'none' }
  if (toolChoice.type === 'any') return { tool_choice: 'required' }
  if (toolChoice.type === 'tool') {
    return { tool_choice: { type: 'function', name: toolChoice.name } }
  }
  return undefined
}

function toResponsesTool(
  tool: NonNullable<BetaMessageStreamParams['tools']>[number],
): ResponsesTool {
  const custom = tool as { name: string; description?: string; input_schema: unknown }
  return {
    type: 'function',
    name: custom.name,
    description: custom.description,
    parameters: custom.input_schema,
    strict: false,
  }
}

function toResponsesTextFormat(
  format: unknown,
): ResponsesRequest['text'] | undefined {
  if (!format || typeof format !== 'object') return undefined
  const value = format as { type?: unknown; schema?: unknown }
  if (value.type !== 'json_schema' || !value.schema) return undefined
  return {
    format: { type: 'json_schema', name: 'response', strict: true, schema: value.schema },
  }
}

function extractReasoningEffort(blob: VariantBlob | undefined): string | undefined {
  const effort = blob?.reasoningEffort
  return typeof effort === 'string' && effort.length > 0 ? effort : undefined
}

function toResponsesInput(
  messages: BetaMessageStreamParams['messages'],
): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = []
  for (const message of messages) {
    if (typeof message.content === 'string') {
      const isAssistant = message.role === 'assistant'
      input.push({
        type: 'message',
        role: isAssistant ? 'assistant' : 'user',
        content: [{ type: isAssistant ? 'output_text' : 'input_text', text: message.content }],
      })
      continue
    }
    const blocks = message.content as Array<{ type: string } & Record<string, unknown>>
    if (message.role === 'assistant') {
      input.push(...assistantBlocksToInput(blocks))
    } else {
      input.push(...userBlocksToInput(blocks))
    }
  }
  return input.length ? input : []
}

function userBlocksToInput(
  blocks: Array<{ type: string } & Record<string, unknown>>,
): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = []
  let parts: ResponsesContentPart[] = []
  const flush = () => {
    if (!parts.length) return
    items.push({ type: 'message', role: 'user', content: parts })
    parts = []
  }
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push({ type: 'input_text', text: asString(block.text) ?? '' })
      continue
    }
    if (block.type === 'image') {
      parts.push(toResponsesImage(block.source))
      continue
    }
    if (block.type === 'tool_result') {
      flush()
      items.push({
        type: 'function_call_output',
        call_id: asString(block.tool_use_id) ?? '',
        output: toolResultContent(block.content),
      })
    }
  }
  flush()
  return items
}

function assistantBlocksToInput(
  blocks: Array<{ type: string } & Record<string, unknown>>,
): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = []
  let parts: ResponsesContentPart[] = []
  const flush = () => {
    if (!parts.length) return
    items.push({ type: 'message', role: 'assistant', content: parts })
    parts = []
  }
  for (const block of blocks) {
    if (block.type === 'text') {
      const text = asString(block.text)
      // Assistant history uses output_text parts. input_text is rejected
      // on assistant messages upstream.
      if (text) parts.push({ type: 'output_text', text })
      continue
    }
    if (block.type === 'tool_use') {
      flush()
      items.push({
        type: 'function_call',
        call_id: asString(block.id) ?? `call_${randomUUID()}`,
        name: asString(block.name) ?? 'tool',
        arguments: stringifyJson(block.input ?? {}),
      })
    }
  }
  flush()
  return items
}

function toResponsesImage(source: unknown): ResponsesContentPart {
  const value = source as {
    type?: unknown
    media_type?: unknown
    data?: unknown
    url?: unknown
  } | undefined
  const mediaType = asString(value?.media_type)
  const data = asString(value?.data)
  if (mediaType && data) {
    return { type: 'input_image', image_url: `data:${mediaType};base64,${data}`, detail: 'auto' }
  }
  const url = asString(value?.url)
  if (url) return { type: 'input_image', image_url: url, detail: 'auto' }
  throw new Error('Responses image block has an unsupported source')
}

export function createResponsesMessage(
  parsed: ResponsesResponse,
  params: BetaMessageStreamParams,
  requestId: string | null,
): Record<string, unknown> {
  if (parsed.error) {
    throw new Error(
      `Responses request failed: ${asString(parsed.error.message) ?? 'Unknown provider error'}`,
    )
  }
  const output = parsed.output ?? []
  const content: Array<Record<string, unknown>> = []
  let text = ''
  const calls: Array<{ id: string; name: string; input: unknown }> = []

  for (const item of output) {
    if (item.type === 'message') {
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && part.text) text += part.text
        else if (part.type === 'refusal' && part.refusal) text += part.refusal
      }
    } else if (item.type === 'function_call') {
      const name = asString(item.name)
      if (!name) throw new Error('Responses tool call did not include a name')
      validateToolName(name, params)
      calls.push({
        id: asString(item.call_id) ?? asString(item.id) ?? `toolu_${randomUUID()}`,
        name,
        input: parseToolInput(asString(item.arguments)),
      })
    }
  }

  const textual = calls.length === 0 ? parseTextualToolCall(text || null, params) : null
  if (textual) {
    content.push({
      type: 'tool_use',
      id: `toolu_${randomUUID()}`,
      name: textual.name,
      input: textual.input,
    })
  } else {
    if (text) content.push({ type: 'text', text })
    for (const call of calls) {
      content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
    }
  }

  return {
    id: parsed.id ?? `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    content,
    stop_reason: textual
      ? 'tool_use'
      : calls.length > 0
        ? 'tool_use'
        : mapResponsesStopReason(parsed),
    stop_sequence: null,
    usage: toAnthropicUsage(parsed.usage),
    _request_id: requestId ?? undefined,
  }
}

export function fromResponsesStream(
  body: ReadableStream<Uint8Array>,
  params: BetaMessageStreamParams,
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
        model: params.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: toAnthropicUsage(),
      },
    }

    let nextBlockIndex = 0
    let reasoningBlockIndex: number | undefined
    let reasoningOpen = false
    let textBlockIndex: number | undefined
    let textualCandidate = ''
    let stopReason: string | null = null
    let usage = toAnthropicUsage()
    let sawCompleted = false
    let failedError: string | undefined
    const tools = new Map<number, ToolAccumulator>()

    for await (const data of readSSEData(body)) {
      for (const event of parseResponsesEvents(data)) {
        if (isResponsesErrorPayload(event)) {
          throw new Error(
            `Responses stream failed: ${asString(event.error?.message) ?? 'Unknown provider error'}`,
          )
        }
        const kind = asString(event.type) ?? ''
        if (kind === 'ping' || !kind) continue

        if (kind === 'response.output_text.delta') {
          const text = asString(event.delta) ?? asString(event.text) ?? ''
          if (text) {
            if (tools.size > 0) {
              throw new Error('Responses stream emitted text after tool calls')
            }
            if (reasoningOpen && reasoningBlockIndex !== undefined) {
              yield { type: 'content_block_stop', index: reasoningBlockIndex }
              reasoningOpen = false
              reasoningBlockIndex = undefined
            }
            const candidate = textualCandidate + text
            if (textBlockIndex === undefined && tools.size === 0 && isPotentialTextualToolCall(candidate)) {
              textualCandidate = candidate
            } else {
              if (textualCandidate) {
                textBlockIndex = yield* yieldTextDelta(textualCandidate, textBlockIndex, nextBlockIndex)
                if (textBlockIndex === nextBlockIndex) nextBlockIndex += 1
                textualCandidate = ''
              }
              const prev = textBlockIndex
              textBlockIndex = yield* yieldTextDelta(text, textBlockIndex, nextBlockIndex)
              if (prev === undefined) nextBlockIndex += 1
            }
          }
          continue
        }

        if (kind === 'response.output_text.done') {
          const text = asString(event.text) ?? ''
          if (text && textBlockIndex === undefined && !textualCandidate) {
            textBlockIndex = yield* yieldTextDelta(text, textBlockIndex, nextBlockIndex)
            nextBlockIndex += 1
          }
          continue
        }

        if (
          kind === 'response.reasoning_summary_text.delta' ||
          kind === 'response.reasoning_text.delta'
        ) {
          const text = asString(event.delta) ?? asString(event.text) ?? ''
          if (text) {
            if (tools.size > 0) {
              throw new Error('Responses stream emitted reasoning after tool calls')
            }
            const prev = reasoningBlockIndex
            reasoningBlockIndex = yield* yieldReasoningDelta(text, reasoningBlockIndex, nextBlockIndex)
            reasoningOpen = true
            if (prev === undefined) nextBlockIndex += 1
          }
          continue
        }

        if (kind === 'response.function_call_arguments.delta') {
          if (reasoningOpen && reasoningBlockIndex !== undefined) {
            yield { type: 'content_block_stop', index: reasoningBlockIndex }
            reasoningOpen = false
            reasoningBlockIndex = undefined
          }
          if (textBlockIndex !== undefined) {
            yield { type: 'content_block_stop', index: textBlockIndex }
            textBlockIndex = undefined
          }
          const index = event.output_index ?? 0
          const acc = getOrCreateTool(index)
          const callId = asString(event.item_id) ?? asString((event.item as ResponsesOutputItem | undefined)?.call_id)
          if (callId && !acc.id) acc.id = callId
          const name = asString((event.item as ResponsesOutputItem | undefined)?.name)
          if (name && !acc.name) acc.name = name
          const delta = asString(event.delta) ?? asString(event.arguments) ?? ''
          if (delta) acc.arguments += delta
          continue
        }

        if (kind === 'response.output_item.added') {
          const item = event.item
          if (item?.type === 'function_call') {
            if (reasoningOpen && reasoningBlockIndex !== undefined) {
              yield { type: 'content_block_stop', index: reasoningBlockIndex }
              reasoningOpen = false
              reasoningBlockIndex = undefined
            }
            if (textBlockIndex !== undefined) {
              yield { type: 'content_block_stop', index: textBlockIndex }
              textBlockIndex = undefined
            }
            const index = event.output_index ?? 0
            const acc = getOrCreateTool(index)
            if (asString(item.call_id)) acc.id = asString(item.call_id)
            else if (asString(item.id) && !acc.id) acc.id = asString(item.id)
            if (asString(item.name)) acc.name = asString(item.name)
            if (asString(item.arguments) && !acc.arguments) acc.arguments = asString(item.arguments)!
          }
          continue
        }

        if (kind === 'response.output_item.done') {
          const item = event.item
          const index = event.output_index ?? 0
          if (item?.type === 'function_call') {
            const acc = getOrCreateTool(index)
            if (asString(item.call_id)) acc.id = asString(item.call_id)
            if (asString(item.name)) acc.name = asString(item.name)
            const full = asString(item.arguments) ?? ''
            if (full && !acc.arguments) acc.arguments = full
          } else if (item?.type === 'message') {
            const full = (item.content ?? [])
              .map(part => (part.type === 'output_text' ? part.text ?? '' : ''))
              .join('')
            if (full && textBlockIndex === undefined && tools.size === 0 && !textualCandidate) {
              textBlockIndex = yield* yieldTextDelta(full, textBlockIndex, nextBlockIndex)
              nextBlockIndex += 1
            }
          }
          continue
        }

        if (kind === 'response.completed' || kind === 'response.incomplete' || kind === 'response.failed') {
          const response = event.response
          if (response) {
            if (response.usage) usage = toAnthropicUsage(response.usage)
            if (response.error) failedError = asString(response.error.message)
            const mapped = mapResponsesStopReason(response)
            if (mapped !== 'end_turn' || !stopReason) stopReason = mapped
            if (kind !== 'response.completed' && !stopReason) stopReason = mapped
          }
          sawCompleted = true
          continue
        }
      }
    }

    function getOrCreateTool(index: number): ToolAccumulator {
      let acc = tools.get(index)
      if (!acc) {
        acc = { blockIndex: nextBlockIndex, arguments: '' }
        tools.set(index, acc)
        nextBlockIndex += 1
      }
      return acc
    }

    if (!sawCompleted) {
      throw new Error('Responses stream ended before completion')
    }
    if (failedError) {
      throw new Error(`Responses stream failed: ${failedError}`)
    }

    const textual = tools.size === 0 ? parseTextualToolCall(textualCandidate || null, params) : null
    if (textual) {
      yield {
        type: 'content_block_start',
        index: nextBlockIndex,
        content_block: { type: 'tool_use', id: `toolu_${randomUUID()}`, name: textual.name, input: {} },
      }
      yield {
        type: 'content_block_delta',
        index: nextBlockIndex,
        delta: { type: 'input_json_delta', partial_json: stringifyJson(textual.input) },
      }
      yield { type: 'content_block_stop', index: nextBlockIndex }
      stopReason = 'tool_use'
    } else if (textualCandidate) {
      const prev = textBlockIndex
      textBlockIndex = yield* yieldTextDelta(textualCandidate, textBlockIndex, nextBlockIndex)
      if (prev === undefined) nextBlockIndex += 1
    }

    if (reasoningOpen && reasoningBlockIndex !== undefined) {
      yield { type: 'content_block_stop', index: reasoningBlockIndex }
    }    if (textBlockIndex !== undefined) yield { type: 'content_block_stop', index: textBlockIndex }
    for (const tool of [...tools.values()].sort((a, b) => a.blockIndex - b.blockIndex)) {
      if (!tool.name) throw new Error('Responses tool call did not include a name')
      validateToolName(tool.name, params)
      parseToolInput(tool.arguments || undefined)
      yield {
        type: 'content_block_start',
        index: tool.blockIndex,
        content_block: {
          type: 'tool_use',
          id: tool.id ?? `toolu_${randomUUID()}`,
          name: tool.name,
          input: {},
        },
      }
      yield {
        type: 'content_block_delta',
        index: tool.blockIndex,
        delta: { type: 'input_json_delta', partial_json: tool.arguments || '{}' },
      }
      yield { type: 'content_block_stop', index: tool.blockIndex }
    }
    if (tools.size > 0) stopReason = 'tool_use'
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

function* yieldReasoningDelta(
  text: string,
  existing: number | undefined,
  next: number,
): Generator<AnthropicStreamEvent, number> {
  const index = existing ?? next
  if (existing === undefined) {
    yield { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } }
  }
  yield { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: text } }
  return index
}

function* yieldTextDelta(
  text: string,
  existing: number | undefined,
  next: number,
): Generator<AnthropicStreamEvent, number> {
  const index = existing ?? next
  if (existing === undefined) {
    yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
  }
  yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text } }
  return index
}

function mapResponsesStopReason(response: ResponsesResponse): string {
  const reason = response.incomplete_details?.reason
  if (reason === 'max_output_tokens') return 'max_tokens'
  if (reason === 'content_filter') return 'stop_sequence'
  const output = response.output ?? []
  if (output.some(item => item.type === 'function_call')) return 'tool_use'
  return 'end_turn'
}

function toAnthropicUsage(usage?: ResponsesResponse['usage'] | null) {
  return {
    input_tokens: finiteCount(usage?.input_tokens),
    output_tokens: finiteCount(usage?.output_tokens),
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }
}

function finiteCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
}

async function* readSSEData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
        const data = sseData(event)
        if (data) yield data
        boundary = buffer.indexOf('\n\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      const data = sseData(buffer)
      if (data) yield data
    }
  } finally {
    reader.releaseLock()
  }
}

function sseData(event: string): string | undefined {
  const data = event
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
    .trim()
  if (data && data !== '[DONE]') return data
  return undefined
}

function parseResponsesEvents(frame: string): ResponsesStreamEvent[] {
  try {
    return [JSON.parse(frame) as ResponsesStreamEvent]
  } catch (error) {
    const lines = frame
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
    if (lines.length > 1) {
      try {
        return lines.map(line => JSON.parse(line) as ResponsesStreamEvent)
      } catch {
        // Fall through to the original error below.
      }
    }
    throw new Error(
      `Responses stream returned invalid JSON chunk: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function isResponsesErrorPayload(value: ResponsesStreamEvent): value is ResponsesStreamEvent & {
  error: { message?: unknown }
} {
  return !!value && typeof value === 'object' && 'error' in value && !value.type && !!(value as { error?: unknown }).error
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseToolInput(input: string | undefined): unknown {
  if (!input) return {}
  try {
    const parsed = JSON.parse(input) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Responses tool arguments must be a JSON object')
    }
    return parsed
  } catch {
    throw new Error('Responses tool arguments were not valid JSON')
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

function isPotentialTextualToolCall(text: string): boolean {
  const trimmed = text.trimStart()
  return 'Tool call'.startsWith(trimmed) || trimmed.startsWith('Tool call')
}

function parseTextualToolCall(
  text: string | null | undefined,
  params: BetaMessageStreamParams,
): { name: string; input: unknown } | null {
  if (!text) return null
  const match = text.trim().match(/^Tool call\s+([A-Za-z0-9_-]+):\s*([\s\S]+)$/)
  if (!match) return null
  try {
    validateToolName(match[1]!, params)
  } catch {
    return null
  }
  try {
    const input = JSON.parse(match[2]!.trim()) as unknown
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null
    return { name: match[1]!, input }
  } catch {
    return null
  }
}

function validateToolName(name: string, params: BetaMessageStreamParams): void {
  if (params.tool_choice?.type === 'none') {
    throw new Error('Responses provider returned a tool call when tools were disabled')
  }
  const offered = new Set(
    (params.tools ?? []).flatMap(tool =>
      'name' in tool && typeof tool.name === 'string' ? [tool.name] : [],
    ),
  )
  if (!offered.has(name)) {
    throw new Error(`Responses provider returned unoffered tool ${name}`)
  }
  if (params.tool_choice?.type === 'tool' && params.tool_choice.name !== name) {
    throw new Error(
      `Responses provider returned tool ${name} instead of required tool ${params.tool_choice.name}`,
    )
  }
}
