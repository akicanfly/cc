import { readCompatibleSSE as readSSE } from './openaiCompatibleSSE.js'
import { parseToolInput, isPotentialTextualToolCall, parseTextualToolCall, validateToolName } from './openaiCompatibleTools.js'
import type { ClientOptions } from '@anthropic-ai/sdk'
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
} from '@anthropic-ai/sdk/error'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import { compatibleText, compatibleReasoning, compatibleUsage, stringifyCompatibleJSON as stringifyJson, readCompatibleJSON, type CompatibleContent } from './openaiCompatiblePayload.js'
import { appendReasoningDetails, reasoningSignature, type ReasoningDetail } from './openaiCompatibleReasoning.js'
import { systemMessages, toOpenAIMessages, type OpenAIMessage } from './openaiCompatibleMessages.js'
import { postCompatibleRequest, connectionFailureMessage, compatibleRequestHeaders, compatibleTimeoutError } from './openaiCompatibleTransport.js'
import {
  createOpenAICompatibleResponseError,
  createOpenAICompatibleStreamError,
  isOpenAIErrorPayload,
  type OpenAIErrorPayload,
} from './openaiCompatibleErrors.js'
import {
  shouldSendOpenAISamplingParams,
  shouldSendOpenAIStreamOptions,
  shouldUseMaxCompletionTokens,
  shouldUseResponsesAPI,
  isOpenRouterBaseURL,
} from './openaiCompatibleQuirks.js'
import {
  createResponsesMessage,
  fromResponsesStream,
  toResponsesRequest,
} from './openaiCompatibleResponses.js'
import {
  type OpenAICompatibleConfig,
  requireOpenAICompatibleConfig,
} from 'src/utils/openAICompatibleConfig.js'

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

type OpenAIChatRequest = {
  model: string
  stream: boolean
  stream_options?: { include_usage: boolean }
  messages: OpenAIMessage[]
  tools?: OpenAIChatTool[]
  tool_choice?: OpenAIToolChoice
  max_tokens?: number
  max_completion_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string[]
  usage?: { include: boolean }
  provider?: { require_parameters: boolean }
  response_format?: {
    type: 'json_schema'
    json_schema: { name: string; strict: boolean; schema: unknown }
  }
}

type OpenAIChatCompletion = {
  id?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: CompatibleContent
      reasoning_content?: string | null
      reasoning?: string | null
      reasoning_details?: ReasoningDetail[]
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  usage?: OpenAIUsage
}

type OpenAIChunkDelta = {
  content?: CompatibleContent
  reasoning_content?: string | null
  reasoning?: string | null
  reasoning_details?: ReasoningDetail[]
  tool_calls?: OpenAIToolCallDelta[] | null
}

type OpenAIChunk = {
  id?: string
  choices?: Array<{
    delta?: OpenAIChunkDelta | null
    message?: OpenAIChunkDelta | null
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
  prompt_tokens_details?: { cached_tokens?: number } | null
  cached_tokens?: number
  prompt_cache_hit_tokens?: number
}

type ToolAccumulator = {
  blockIndex: number
  id?: string
  name?: string
  arguments: string
}

export async function listOpenAICompatibleModels(): Promise<string[]> {
  const config = requireOpenAICompatibleConfig()
  const timeout = timeoutSignal(config.timeoutMs)
  let response: Response
  try {
    response = await globalThis.fetch(`${config.baseURL}${config.modelsPath ?? '/models'}`, {
      method: 'GET',
      signal: timeout,
      headers: compatibleRequestHeaders(config),
    })
  } catch (error) {
    if (timeout.aborted) {
      throw compatibleTimeoutError('OpenAI-compatible models request timed out', error)
    }
    throw new APIConnectionError({
      message: connectionFailureMessage(config.baseURL, error),
      cause: error instanceof Error ? error : undefined,
    })
  }

  if (!response.ok) {
    throw await createOpenAICompatibleResponseError(response, 'models request')
  }

  const parsed = await readCompatibleJSON(response)
  if (!Array.isArray(parsed.data)) {
    throw new Error('OpenAI-compatible models response did not contain a data array; enter a model ID manually if this provider has no model catalogue')
  }
  return (parsed.data as Array<{ id?: string }>)
    .map(model => model && typeof model === 'object' ? model.id : undefined)
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
        create(
          params: BetaMessageStreamParams,
          options?: { signal?: AbortSignal; timeout?: number },
        ) {
          if (!params.stream) {
            return createOpenAICompatibleMessage(
              params,
              options?.signal,
              options?.timeout,
              fetchOverride,
            )
          }
          return {
            withResponse: () =>
              createOpenAICompatibleStream(
                params,
                options?.signal,
                options?.timeout,
                fetchOverride,
              ),
          }
        },
      },
    },
  }
}

async function createOpenAICompatibleMessage(
  params: BetaMessageStreamParams,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  fetchOverride: ClientOptions['fetch'] | undefined,
): Promise<Record<string, unknown>> {
  const config = requireOpenAICompatibleConfig()
  if (shouldUseResponsesAPI(params.model, config.baseURL, {}, config)) {
    const response = await postOpenAIResponse({
      config,
      params,
      stream: false,
      signal,
      timeoutMs,
      fetchOverride,
    })
    const parsed = (await readCompatibleJSON(response)) as Parameters<typeof createResponsesMessage>[0]
    return createResponsesMessage(
      parsed,
      params,
      response.headers.get('x-request-id'),
    )
  }
  const response = await postOpenAIChatCompletion({
    config,
    params,
    stream: false,
    signal,
    timeoutMs,
    fetchOverride,
  })

  const parsed = (await readCompatibleJSON(response)) as OpenAIChatCompletion
  const message = parsed.choices?.[0]?.message
  if (!message) {
    throw new Error('OpenAI-compatible response did not contain choices[0].message')
  }
  const textualToolCall = parseTextualToolCall(compatibleText(message.content), params)
  const content: Array<Record<string, unknown>> = []
  const reasoning = compatibleReasoning(message)
  if (reasoning || message.reasoning_details?.length) content.push({
    type: 'thinking', thinking: reasoning,
    signature: message.reasoning_details?.length ? reasoningSignature(message.reasoning_details) : '',
  })

  if (textualToolCall && !message?.tool_calls?.length) {
    content.push({
      type: 'tool_use',
      id: `toolu_${randomUUID()}`,
      name: textualToolCall.name,
      input: textualToolCall.input,
    })
  } else {
    const text = compatibleText(message.content)
    if (text) content.push({ type: 'text', text })
    for (const toolCall of message?.tool_calls ?? []) {
      if (toolCall.type && toolCall.type !== 'function') continue
      const name = toolCall.function?.name
      if (!name) {
        throw new Error('OpenAI-compatible tool call did not include a name')
      }
      validateToolName(name, params)
      content.push({
        type: 'tool_use',
        id: toolCall.id ?? `toolu_${randomUUID()}`,
        name,
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
      content.some(block => block.type === 'tool_use')
        ? 'tool_use'
        : mapStopReason(parsed.choices?.[0]?.finish_reason),
    stop_sequence: null,
    usage: compatibleUsage(parsed.usage),
    _request_id: response.headers.get('x-request-id') ?? undefined,
  }
}

async function createOpenAICompatibleStream(
  params: BetaMessageStreamParams,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  fetchOverride: ClientOptions['fetch'] | undefined,
): Promise<{
  data: AsyncIterable<AnthropicStreamEvent> & { controller: AbortController }
  response: Response
  request_id: string | null
}> {
  const config = requireOpenAICompatibleConfig()
  const controller = linkedAbortController(signal)
  if (shouldUseResponsesAPI(params.model, config.baseURL, {}, config)) {
    const response = await postOpenAIResponse({
      config,
      params,
      stream: true,
      signal: controller.signal,
      timeoutMs,
      fetchOverride,
    })
    if (!response.body) {
      throw new Error('Responses request failed: response body is empty')
    }
    const requestId = response.headers.get('x-request-id')
    return {
      data: fromResponsesStream(await compatibleResponseBody(response, true), params, controller, response.headers),
      response,
      request_id: requestId,
    }
  }
  const response = await postOpenAIChatCompletion({
    config,
    params,
    stream: true,
    signal: controller.signal,
    timeoutMs,
    fetchOverride,
  })

  if (!response.body) {
    throw new Error('OpenAI-compatible request failed: response body is empty')
  }

  const requestId = response.headers.get('x-request-id')
  const body = await compatibleResponseBody(response, false)
  return {
    data: fromOpenAIStream(body, params, controller),
    response,
    request_id: requestId,
  }
}

async function postOpenAIChatCompletion({
  config,
  params,
  stream,
  signal,
  timeoutMs,
  fetchOverride,
}: {
  config: OpenAICompatibleConfig
  params: BetaMessageStreamParams
  stream: boolean
  signal: AbortSignal | undefined
  timeoutMs: number | undefined
  fetchOverride: ClientOptions['fetch'] | undefined
}): Promise<Response> {
  const timeout = timeoutSignal(timeoutMs ?? config.timeoutMs)
  const requestSignal = combineAbortSignals(signal, timeout)

  try {
    return await postCompatibleRequest({
      config,
      path: config.chatCompletionsPath ?? '/chat/completions',
      body: toOpenAIRequest(params, stream, config),
      signal: requestSignal,
      fetchOverride,
    })
  } catch (error) {
    if (signal?.aborted) throw new APIUserAbortError()
    if (timeout.aborted) {
      throw compatibleTimeoutError('OpenAI-compatible request timed out', error)
    }
    if (error instanceof APIError) throw error
    throw new APIConnectionError({
      message: connectionFailureMessage(config.baseURL, error),
      cause: error instanceof Error ? error : undefined,
    })
  }
}

async function postOpenAIResponse({
  config,
  params,
  stream,
  signal,
  timeoutMs,
  fetchOverride,
}: {
  config: OpenAICompatibleConfig
  params: BetaMessageStreamParams
  stream: boolean
  signal: AbortSignal | undefined
  timeoutMs: number | undefined
  fetchOverride: ClientOptions['fetch'] | undefined
}): Promise<Response> {
  const timeout = timeoutSignal(timeoutMs ?? config.timeoutMs)
  const requestSignal = combineAbortSignals(signal, timeout)

  try {
    return await postCompatibleRequest({
      config,
      path: config.responsesPath ?? '/responses',
      body: toResponsesRequest(params, stream, config),
      signal: requestSignal,
      fetchOverride,
    })
  } catch (error) {
    if (signal?.aborted) throw new APIUserAbortError()
    if (timeout.aborted) {
      throw compatibleTimeoutError('Responses request timed out', error)
    }
    if (error instanceof APIError) throw error
    throw new APIConnectionError({
      message: connectionFailureMessage(config.baseURL, error),
      cause: error instanceof Error ? error : undefined,
    })
  }
}

function toOpenAIRequest(
  params: BetaMessageStreamParams,
  stream: boolean,
  config: OpenAICompatibleConfig,
): OpenAIChatRequest {
  const toolChoice = toOpenAIToolChoice(params.tool_choice)
  const sendSamplingParams = shouldSendOpenAISamplingParams(params.model, {}, config)

  const tools = params.tools?.length
    ? params.tools.map(toOpenAITool)
    : undefined
  const tokenLimit = params.max_tokens
  const useCompletionTokens = shouldUseMaxCompletionTokens(params.model, {}, config)
  const responseFormat = toOpenAIResponseFormat(params.output_config?.format)
  const openRouter = isOpenRouterBaseURL(config.baseURL)

  return {
    model: params.model,
    stream,
    ...(stream && shouldSendOpenAIStreamOptions(config.baseURL, {}, config) ? { stream_options: { include_usage: true } } : {}),
    messages: [
      ...systemMessages(params.system, openRouter),
      ...params.messages.flatMap(message => toOpenAIMessages(message, openRouter)),
    ],
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(tokenLimit !== undefined && useCompletionTokens
      ? { max_completion_tokens: tokenLimit }
      : tokenLimit !== undefined
        ? { max_tokens: tokenLimit }
        : {}),
    ...(sendSamplingParams && params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(sendSamplingParams && params.top_p !== undefined ? { top_p: params.top_p } : {}),
    ...(params.stop_sequences?.length ? { stop: params.stop_sequences } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(openRouter ? {
      usage: { include: true },
      ...(tools || responseFormat ? { provider: { require_parameters: true } } : {}),
    } : {}),
  }
}

function toOpenAIResponseFormat(format: unknown): OpenAIChatRequest['response_format'] | undefined {
  if (!format || typeof format !== 'object') return undefined
  const value = format as { type?: unknown; schema?: unknown }
  if (value.type !== 'json_schema' || !value.schema) return undefined
  return {
    type: 'json_schema',
    json_schema: { name: 'response', strict: true, schema: value.schema },
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

function fromOpenAIStream(
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
        usage: compatibleUsage(),
      },
    }

    let nextBlockIndex = 0
    let reasoningBlockIndex: number | undefined
    let reasoningBlockOpen = false
    let textBlockIndex: number | undefined
    let textualToolCandidate = ''
    let stopReason: string | null = null
    let usage = compatibleUsage()
    let sawChoice = false
    let sawFinishReason = false
    let sawToolCall = false
    const details = new Map<number, ReasoningDetail>()
    const tools = new Map<number, ToolAccumulator>()

    for await (const frame of readSSE(body)) {
      for (const parsed of parseOpenAIChunks(frame)) {
        if (isOpenAIErrorPayload(parsed)) {
          throw createOpenAICompatibleStreamError(parsed)
        }
        if (parsed.usage) usage = compatibleUsage(parsed.usage)
        const choice = parsed.choices?.[0]
        if (choice) sawChoice = true
        if (choice?.finish_reason) {
          sawFinishReason = true
          stopReason = mapStopReason(choice.finish_reason)
        }
        const delta = choice?.delta ?? choice?.message
        if (!delta) continue

        if (delta.reasoning_details) appendReasoningDetails(details, delta.reasoning_details)
        const reasoning = compatibleReasoning(delta)
        if (reasoning || delta.reasoning_details?.length) {
          if (textBlockIndex !== undefined) {
            yield { type: 'content_block_stop', index: textBlockIndex }
            textBlockIndex = undefined
          }
          if (tools.size > 0) {
            yield* emitToolBlocks(tools, params)
            tools.clear()
          }
          const previousIndex = reasoningBlockIndex
          reasoningBlockIndex = yield* yieldReasoningDelta(
            reasoning,
            reasoningBlockIndex,
            nextBlockIndex,
          )
          reasoningBlockOpen = true
          if (previousIndex === undefined) nextBlockIndex += 1
        }

        const text = compatibleText(delta.content)
        if (text) {
          if (tools.size > 0) {
            yield* emitToolBlocks(tools, params)
            tools.clear()
          }
          if (reasoningBlockOpen && reasoningBlockIndex !== undefined) {
            yield* closeReasoningBlock(reasoningBlockIndex, details)
            reasoningBlockOpen = false
            reasoningBlockIndex = undefined
          }
          const candidate = textualToolCandidate + text
          if (textBlockIndex === undefined && tools.size === 0 && isPotentialTextualToolCall(candidate)) {
            textualToolCandidate = candidate
          } else {
            if (textualToolCandidate) {
              textBlockIndex = yield* yieldTextDelta(textualToolCandidate, textBlockIndex, nextBlockIndex)
              if (textBlockIndex === nextBlockIndex) nextBlockIndex += 1
              textualToolCandidate = ''
            }
            const previousIndex = textBlockIndex
            textBlockIndex = yield* yieldTextDelta(text, textBlockIndex, nextBlockIndex)
            if (previousIndex === undefined) nextBlockIndex += 1
          }
        }

        for (const [fallbackIndex, toolDelta] of (delta.tool_calls ?? []).entries()) {
          if (toolDelta.type && toolDelta.type !== 'function') continue
          sawToolCall = true
          toolDelta.index ??= fallbackIndex
          if (reasoningBlockOpen && reasoningBlockIndex !== undefined) {
            yield* closeReasoningBlock(reasoningBlockIndex, details)
            reasoningBlockOpen = false
            reasoningBlockIndex = undefined
          }
          if (textBlockIndex !== undefined) {
            yield { type: 'content_block_stop', index: textBlockIndex }
            textBlockIndex = undefined
          }
          const events = appendToolDelta(tools, toolDelta, nextBlockIndex)
          if (events.created) nextBlockIndex += 1
        }
      }
    }

    if (!sawChoice || !sawFinishReason) {
      throw new Error('OpenAI-compatible stream ended before a finish reason was received')
    }

    const textualToolCall = !sawToolCall && tools.size === 0
      ? parseTextualToolCall(textualToolCandidate, params)
      : null
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

    if (reasoningBlockOpen && reasoningBlockIndex !== undefined) yield* closeReasoningBlock(reasoningBlockIndex, details)
    if (textBlockIndex !== undefined) yield { type: 'content_block_stop', index: textBlockIndex }
    yield* emitToolBlocks(tools, params)
    if (sawToolCall && stopReason === 'end_turn') stopReason = 'tool_use'
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

function* closeReasoningBlock(index: number, details: Map<number, ReasoningDetail>): Generator<AnthropicStreamEvent> {
  if (details.size) {
    yield { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: reasoningSignature([...details.entries()].sort(([a], [b]) => a - b).map(([, value]) => value)) } }
    details.clear()
  }
  yield { type: 'content_block_stop', index }
}

function* emitToolBlocks(
  tools: Map<number, ToolAccumulator>,
  params: BetaMessageStreamParams,
): Generator<AnthropicStreamEvent> {
  for (const tool of [...tools.values()].sort(
    (a, b) => a.blockIndex - b.blockIndex,
  )) {
    if (!tool.name) {
      throw new Error('OpenAI-compatible tool call did not include a name')
    }
    validateToolName(tool.name, params)
    parseToolInput(tool.arguments)
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
      delta: {
        type: 'input_json_delta',
        partial_json: tool.arguments || '{}',
      },
    }
    yield { type: 'content_block_stop', index: tool.blockIndex }
  }
}

function* yieldReasoningDelta(
  text: string,
  existingIndex: number | undefined,
  nextBlockIndex: number,
): Generator<AnthropicStreamEvent, number> {
  const index = existingIndex ?? nextBlockIndex
  if (existingIndex === undefined) {
    yield { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } }
  }
  yield { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: text } }
  return index
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
): { created: boolean } {
  const openAIIndex = delta.index ?? 0
  let tool = tools.get(openAIIndex)
  let created = false
  if (!tool) {
    tool = { blockIndex: nextBlockIndex, arguments: '' }
    tools.set(openAIIndex, tool)
    created = true
  }
  if (delta.id) tool.id = delta.id
  if (delta.function?.name) tool.name = delta.function.name

  const args = delta.function?.arguments
  if (args) tool.arguments += args
  return { created }
}

function parseOpenAIChunks(frame: string): Array<OpenAIChunk | OpenAIErrorPayload> {
  try {
    return [JSON.parse(frame) as OpenAIChunk | OpenAIErrorPayload]
  } catch (error) {
    const chunks = frame
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
    if (chunks.length > 1) {
      try {
        return chunks.map(chunk => JSON.parse(chunk) as OpenAIChunk | OpenAIErrorPayload)
      } catch {
        // Fall through and report the original parse error below.
      }
    }
    throw new Error(`OpenAI-compatible stream returned invalid JSON chunk: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function mapStopReason(reason: string | null | undefined): string {
  if (reason === 'length') return 'max_tokens'
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use'
  if (reason === 'content_filter') return 'stop_sequence'
  return 'end_turn'
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
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

function combineAbortSignals(
  signal: AbortSignal | undefined,
  timeout: AbortSignal,
): AbortSignal {
  if (!signal) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  const controller = linkedAbortController(signal)
  if (timeout.aborted) controller.abort(timeout.reason)
  else {
    timeout.addEventListener('abort', () => controller.abort(timeout.reason), {
      once: true,
    })
  }
  return controller.signal
}

async function compatibleResponseBody(response: Response, responses: boolean): Promise<ReadableStream<Uint8Array>> {
  if (!response.body) throw new Error('OpenAI-compatible response body is empty')
  if (!response.headers.get('content-type')?.includes('application/json')) return response.body
  const parsed = await readCompatibleJSON(response)
  const event = responses ? { type: parsed.status === 'failed' ? 'response.failed' : parsed.status === 'incomplete' ? 'response.incomplete' : 'response.completed', response: parsed } : parsed
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`).body!
}
