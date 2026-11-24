import { createOpenAICompatiblePayloadError } from './openaiCompatibleErrors.js'

export type CompatibleContent = string | Array<{
  type?: string | null
  text?: string | null
  thinking?: string | Array<{ type?: string | null; text?: string | null }> | null
}> | null

export function compatibleText(content: CompatibleContent | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(part => part?.type === 'text' ? part.text ?? '' : '').join('')
}

export function compatibleReasoning(message: {
  reasoning_content?: string | null
  reasoning?: string | null
  content?: CompatibleContent
}): string {
  if (message.reasoning_content || message.reasoning) return message.reasoning_content || message.reasoning || ''
  if (!Array.isArray(message.content)) return ''
  return message.content.filter(part => part?.type === 'thinking').flatMap(part => {
    if (typeof part.thinking === 'string') return [part.thinking]
    return Array.isArray(part.thinking) ? part.thinking.map(item => item.text ?? '') : []
  }).join('')
}

// Some compatible providers report failures in a successful HTTP response.
export async function readCompatibleJSON(response: Response): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new Error('OpenAI-compatible provider returned invalid JSON; check the base URL and API endpoint')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OpenAI-compatible provider returned a non-object JSON response')
  }
  const value = parsed as Record<string, unknown>
  const base = value.base_resp as { status_code?: unknown; status_msg?: unknown } | undefined
  if (value.error || (base?.status_code && base.status_code !== 0)) {
    throw createOpenAICompatiblePayloadError(value, response.headers)
  }
  return value
}

export function compatibleUsage(usage?: {
  prompt_tokens?: number
  completion_tokens?: number
  input_tokens?: number
  output_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number } | null
  input_tokens_details?: { cached_tokens?: number } | null
  cached_tokens?: number
  prompt_cache_hit_tokens?: number
} | null) {
  const total = tokenCount(usage?.prompt_tokens ?? usage?.input_tokens)
  const cached = Math.min(total, tokenCount(
    usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens
      ?? usage?.cached_tokens ?? usage?.prompt_cache_hit_tokens,
  ))
  return {
    input_tokens: total - cached,
    output_tokens: tokenCount(usage?.completion_tokens ?? usage?.output_tokens),
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  }
}

function tokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function stringifyCompatibleJSON(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
