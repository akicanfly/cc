import { toolResultContent } from './openaiCompatibleTools.js'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import { reasoningDetails, type ReasoningDetail } from './openaiCompatibleReasoning.js'
import { stringifyCompatibleJSON as stringifyJson } from './openaiCompatiblePayload.js'

type OpenAIUserContentPart =
  | { type: 'text'; text: string; cache_control?: unknown }
  | { type: 'image_url'; image_url: { url: string } }

export type OpenAIMessage =
  | { role: 'system'; content: string | OpenAIUserContentPart[] }
  | {
      role: 'user'
      content: string | OpenAIUserContentPart[]
    }
  | {
      role: 'assistant'
      content: string | null
      reasoning_content?: string
      reasoning_details?: ReasoningDetail[]
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export function systemMessages(system: BetaMessageStreamParams['system'], preserveCache: boolean): OpenAIMessage[] {
  if (!system) return []
  if (typeof system === 'string') return [{ role: 'system', content: system }]
  if (preserveCache) return [{ role: 'system', content: system.map(block => ({
    type: 'text', text: block.text,
    ...(block.cache_control ? { cache_control: block.cache_control } : {}),
  })) }]
  const text = system.map(block => ('text' in block ? block.text : '')).filter(Boolean).join('\n')
  return text ? [{ role: 'system', content: text }] : []
}

export function toOpenAIMessages(
  message: BetaMessageStreamParams['messages'][number],
  preserveCache: boolean,
): OpenAIMessage[] {
  if (typeof message.content === 'string') return [{ role: message.role, content: message.content }]

  const content = message.content as Array<{ type: string } & Record<string, unknown>>
  if (message.role === 'assistant') return toOpenAIAssistantMessages(content, preserveCache)
  return toOpenAIUserMessages(content, preserveCache)
}

function toOpenAIAssistantMessages(content: Array<{ type: string } & Record<string, unknown>>, openRouter: boolean): OpenAIMessage[] {
  const messages: OpenAIMessage[] = []
  let textParts: string[] = []
  let thinkingParts: string[] = []
  let details: ReasoningDetail[] = []
  let toolCalls: NonNullable<Extract<OpenAIMessage, { role: 'assistant' }>['tool_calls']> = []

  const flush = () => {
    if (!textParts.length && !toolCalls.length && !thinkingParts.length && !details.length) return
    const text = textParts.join('\n')
    messages.push({
      role: 'assistant',
      content: text || null,
      ...(openRouter && details.length ? { reasoning_details: details }
        : thinkingParts.length ? { reasoning_content: thinkingParts.join('') } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    })
    textParts = []
    thinkingParts = []
    details = []
    toolCalls = []
  }

  for (const block of content) {
    if (block.type === 'thinking') {
      if (toolCalls.length) flush()
      if (openRouter) details.push(...reasoningDetails(block.signature) ?? [])
      const thinking = asString(block.thinking)
      if (thinking) thinkingParts.push(thinking)
      continue
    }
    if (block.type === 'text') {
      if (toolCalls.length) flush()
      const text = asString(block.text)
      if (text) textParts.push(text)
      continue
    }
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: asString(block.id) ?? `toolu_${randomUUID()}`,
        type: 'function',
        function: {
          name: asString(block.name) ?? 'tool',
          arguments: stringifyJson(block.input ?? {}),
        },
      })
    }
  }

  flush()
  return messages.length ? messages : [{ role: 'assistant', content: null }]
}

function toOpenAIUserMessages(
  content: Array<{ type: string } & Record<string, unknown>>,
  preserveCache = false,
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = []
  let contentParts: OpenAIUserContentPart[] = []
  const toolImages: Array<{ type: string } & Record<string, unknown>> = []

  const flushContent = () => {
    if (!contentParts.length) return
    if (contentParts.length === 1 && contentParts[0]?.type === 'text' && !contentParts[0].cache_control) {
      messages.push({ role: 'user', content: contentParts[0].text })
    } else {
      messages.push({ role: 'user', content: contentParts })
    }
    contentParts = []
  }

  for (const block of content) {
    if (block.type === 'text') {
      contentParts.push({ type: 'text', text: asString(block.text) ?? '',
        ...(preserveCache && block.cache_control ? { cache_control: block.cache_control } : {}),
      })
      continue
    }
    if (block.type === 'image') {
      const source = block.source as {
        type?: unknown
        media_type?: unknown
        data?: unknown
        url?: unknown
      } | undefined
      const mediaType = asString(source?.media_type)
      const data = asString(source?.data)
      if (mediaType && data) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: `data:${mediaType};base64,${data}` },
        })
      } else if (asString(source?.url)) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: asString(source?.url)! },
        })
      } else {
        throw new Error('OpenAI-compatible image block has an unsupported source')
      }
      continue
    }
    if (block.type === 'tool_result') {
      if (Array.isArray(block.content)) {
        for (const part of block.content) {
          if (part?.type === 'image') toolImages.push(part)
        }
      }
      flushContent()
      messages.push({
        role: 'tool',
        tool_call_id: asString(block.tool_use_id) ?? '',
        content: toolResultContent(block.content),
      })
    }
  }

  flushContent()
  if (toolImages.length) {
    messages.push(...toOpenAIUserMessages([
      { type: 'text', text: '[Images returned by the preceding tools]' },
      ...toolImages,
    ]))
  }
  return messages.length ? messages : [{ role: 'user', content: '' }]
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
