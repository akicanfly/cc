import { stringifyCompatibleJSON as stringifyJson } from './openaiCompatiblePayload.js'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

export function parseToolInput(input: string | undefined): unknown {
  if (!input) return {}
  try {
    const parsed = JSON.parse(input) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('OpenAI-compatible tool arguments must be a JSON object')
    }
    return parsed
  } catch {
    throw new Error('OpenAI-compatible tool arguments were not valid JSON')
  }
}

export function isPotentialTextualToolCall(text: string): boolean {
  const trimmed = text.trimStart()
  return 'Tool call'.startsWith(trimmed) || trimmed.startsWith('Tool call')
}

export function parseTextualToolCall(
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

export function validateToolName(
  name: string,
  params: BetaMessageStreamParams,
): void {
  if (params.tool_choice?.type === 'none') {
    throw new Error('OpenAI-compatible provider returned a tool call when tools were disabled')
  }
  const offeredTools = new Set(
    (params.tools ?? []).flatMap(tool =>
      'name' in tool && typeof tool.name === 'string' ? [tool.name] : [],
    ),
  )
  if (!offeredTools.has(name)) {
    throw new Error(`OpenAI-compatible provider returned unoffered tool ${name}`)
  }
  if (
    params.tool_choice?.type === 'tool' &&
    params.tool_choice.name !== name
  ) {
    throw new Error(
      `OpenAI-compatible provider returned tool ${name} instead of required tool ${params.tool_choice.name}`,
    )
  }
}


export function toolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item) {
          return String(item.text)
        }
        if (item && typeof item === 'object' && 'type' in item && item.type === 'image') {
          return '[Image output attached in the following user message]'
        }
        return stringifyJson(item)
      })
      .join('\n')
  }
  return stringifyJson(content ?? '')
}
