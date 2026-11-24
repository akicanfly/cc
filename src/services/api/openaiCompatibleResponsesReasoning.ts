import { APIError } from '@anthropic-ai/sdk/error'

const PREFIX = 'ccc-responses:'
export type ResponsesReasoningItem = {
  type: 'reasoning'
  id?: string
  encrypted_content?: string
  summary: Array<{ type: string; text: string }>
  content?: Array<{ type: string; text: string }>
}

function responsesReasoningItem(value: Record<string, unknown>): ResponsesReasoningItem {
  const textParts = (raw: unknown) => Array.isArray(raw)
    ? raw.filter((part): part is { type: string; text: string } => !!part && typeof part === 'object' && typeof part.type === 'string' && typeof part.text === 'string').map(part => ({ type: part.type, text: part.text })) : []
  return {
    type: 'reasoning',
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    ...(typeof value.encrypted_content === 'string' ? { encrypted_content: value.encrypted_content } : {}),
    summary: textParts(value.summary),
    ...(Array.isArray(value.content) ? { content: textParts(value.content) } : {}),
  }
}

export function responsesReasoningBlock(value: Record<string, unknown>): Record<string, unknown> {
  const item = responsesReasoningItem(value)
  return {
    type: 'thinking', thinking: [...item.summary, ...item.content ?? []].map(part => part.text).join(''),
    signature: PREFIX + JSON.stringify(item),
  }
}

export function restoreResponsesReasoning(signature: unknown): ResponsesReasoningItem | undefined {
  if (typeof signature !== 'string' || !signature.startsWith(PREFIX)) return
  try {
    const value = JSON.parse(signature.slice(PREFIX.length))
    if (!value || value.type !== 'reasoning' || !Array.isArray(value.summary)) throw new Error()
    return responsesReasoningItem(value)
  } catch {
    const message = 'Saved Responses reasoning metadata is invalid'
    throw APIError.generate(400, { error: { message } }, message, undefined)
  }
}
