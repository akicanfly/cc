import { parseToolInput, parseTextualToolCall, validateToolName, toolResultContent } from './openaiCompatibleTools.js'
export { fromResponsesStream } from './openaiCompatibleResponsesStream.js'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import { createOpenAICompatiblePayloadError } from './openaiCompatibleErrors.js'
import { responsesReasoningBlock, restoreResponsesReasoning, type ResponsesReasoningItem } from './openaiCompatibleResponsesReasoning.js'
import type { OpenAICompatibleConfig } from 'src/utils/openAICompatibleConfig.js'
import { compatibleUsage, stringifyCompatibleJSON as stringifyJson } from './openaiCompatiblePayload.js'
import { shouldSendOpenAISamplingParams } from './openaiCompatibleQuirks.js'

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
  | ResponsesReasoningItem
  | { type: 'message'; role: 'user' | 'assistant' | 'system' | 'developer'; content: ResponsesContentPart[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }

export type ResponsesRequest = {
  model: string
  input: ResponsesInputItem[]
  stream: boolean
  store: false
  include?: string[]
  instructions?: string
  tools?: ResponsesTool[]
  tool_choice?: ResponsesToolChoice
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  text?: {
    format: { type: 'json_schema'; name: string; strict: boolean; schema: unknown }
  }
}

export type ResponsesOutputItem = {
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
    input_tokens_details?: { cached_tokens?: number } | null
    total_tokens?: number
  } | null
  error?: { message?: unknown; code?: unknown } | null
  incomplete_details?: { reason?: string | null } | null
  [key: string]: unknown
}

export function toResponsesRequest(
  params: BetaMessageStreamParams,
  stream: boolean,
  config?: OpenAICompatibleConfig,
): ResponsesRequest {
  const sendSamplingParams = shouldSendOpenAISamplingParams(params.model, config ? {} : process.env, config)
  const tools = params.tools?.length
    ? params.tools.map(toResponsesTool)
    : undefined
  const tokenLimit = params.max_tokens
  const responseFormat = toResponsesTextFormat(params.output_config?.format)

  return {
    model: params.model,
    input: toResponsesInput(params.messages),
    stream,
    store: false,
    ...(!config || new URL(config.baseURL).hostname !== 'ark.cn-beijing.volces.com' ? { include: ['reasoning.encrypted_content'] } : {}),
    ...instructionsOf(params.system),
    ...(tools ? { tools } : {}),
    ...(toResponsesToolChoice(params.tool_choice) ?? {}),
    ...(tokenLimit !== undefined ? { max_output_tokens: tokenLimit } : {}),
    ...(sendSamplingParams && params.temperature !== undefined
      ? { temperature: params.temperature }
      : {}),
    ...(sendSamplingParams && params.top_p !== undefined ? { top_p: params.top_p } : {}),
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
  const images: ResponsesContentPart[] = []
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
      if (Array.isArray(block.content)) for (const part of block.content) if (part?.type === 'image') images.push(toResponsesImage(part.source))
      flush()
      items.push({
        type: 'function_call_output',
        call_id: asString(block.tool_use_id) ?? '',
        output: toolResultContent(block.content),
      })
    }
  }
  flush()
  if (images.length) items.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '[Images returned by the preceding tools]' }, ...images] })
  return items
}

function assistantBlocksToInput(
  blocks: Array<{ type: string } & Record<string, unknown>>,
): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = []
  let parts: ResponsesContentPart[] = []
  const reasoningIDs = new Set<string>()
  const flush = () => {
    if (!parts.length) return
    items.push({ type: 'message', role: 'assistant', content: parts })
    parts = []
  }
  for (const block of blocks) {
    if (block.type === 'thinking') {
      const item = restoreResponsesReasoning(block.signature)
      if (item && (!item.id || !reasoningIDs.has(item.id))) {
        flush()
        items.push(item)
        if (item.id) reasoningIDs.add(item.id)
      }
      continue
    }
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
  if (parsed.error || parsed.status === 'failed') {
    throw createOpenAICompatiblePayloadError({ error: parsed.error ?? { message: 'Responses generation failed' } }, new Headers())
  }
  const output = parsed.output ?? []
  const content: Array<Record<string, unknown>> = []
  for (const item of output) {
    if (item.type === 'reasoning') content.push(responsesReasoningBlock(item))
    else if (item.type === 'message') {
      const text = (item.content ?? []).map(part => part.type === 'output_text' ? part.text ?? '' : part.type === 'refusal' ? part.refusal ?? '' : '').join('')
      if (text) content.push({ type: 'text', text })
    } else if (item.type === 'function_call') {
      const name = asString(item.name)
      if (!name) throw new Error('Responses tool call did not include a name')
      validateToolName(name, params)
      content.push({ type: 'tool_use', id: asString(item.call_id) ?? asString(item.id) ?? `toolu_${randomUUID()}`, name, input: parseToolInput(asString(item.arguments)) })
    }
  }
  const hasCalls = content.some(block => block.type === 'tool_use')
  const text = content.filter(block => block.type === 'text').map(block => block.text).join('')
  const textual = !hasCalls ? parseTextualToolCall(text || null, params) : null
  if (textual) {
    for (let i = content.length - 1; i >= 0; i--) if (content[i]?.type === 'text') content.splice(i, 1)
    content.push({ type: 'tool_use', id: `toolu_${randomUUID()}`, name: textual.name, input: textual.input })
  }

  return {
    id: parsed.id ?? `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    content,
    stop_reason: textual
      ? 'tool_use'
      : hasCalls
        ? 'tool_use'
        : mapResponsesStopReason(parsed),
    stop_sequence: null,
    usage: compatibleUsage(parsed.usage),
    _request_id: requestId ?? undefined,
  }
}

function mapResponsesStopReason(response: ResponsesResponse): string {
  const reason = response.incomplete_details?.reason
  if (reason === 'max_output_tokens') return 'max_tokens'
  if (reason === 'content_filter') return 'stop_sequence'
  const output = response.output ?? []
  if (output.some(item => item.type === 'function_call')) return 'tool_use'
  return 'end_turn'
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
