export type OpenAICompatibleConfig = {
  baseURL: string
  apiKey?: string
  headers: Record<string, string>
  timeoutMs: number
}

const DEFAULT_TIMEOUT_MS = 600_000

export function isOpenAICompatibleConfigured(): boolean {
  return !!getBaseURL()
}

export function getOpenAICompatibleConfig(): OpenAICompatibleConfig | undefined {
  const baseURL = getBaseURL()
  const apiKey =
    process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY
  if (!baseURL) return undefined

  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    throw new Error(
      'OpenAI-compatible provider requires a valid OPENAI_COMPATIBLE_BASE_URL or OPENAI_BASE_URL',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OpenAI-compatible base URL must use HTTP or HTTPS')
  }

  return {
    baseURL: baseURL.replace(/\/+$/, ''),
    apiKey,
    headers: parseHeaders(process.env.OPENAI_COMPATIBLE_HEADERS),
    timeoutMs: parseTimeout(
      process.env.OPENAI_COMPATIBLE_TIMEOUT_MS || process.env.API_TIMEOUT_MS,
    ),
  }
}

export function requireOpenAICompatibleConfig(): OpenAICompatibleConfig {
  const config = getOpenAICompatibleConfig()
  if (!config) {
    throw new Error(
      'OpenAI-compatible runtime requires OPENAI_COMPATIBLE_BASE_URL or OPENAI_BASE_URL',
    )
  }
  return config
}

function getBaseURL(): string | undefined {
  return (
    process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.OPENAI_BASE_URL
  )?.trim()
}

function parseTimeout(raw: string | undefined): number {
  if (!raw) return DEFAULT_TIMEOUT_MS
  const timeout = Number(raw)
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error('OPENAI_COMPATIBLE_TIMEOUT_MS must be a positive integer')
  }
  return timeout
}

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(
      'OPENAI_COMPATIBLE_HEADERS must be a valid JSON object with string values',
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'OPENAI_COMPATIBLE_HEADERS must be a valid JSON object with string values',
    )
  }
  const entries = Object.entries(parsed)
  if (entries.some(([, value]) => typeof value !== 'string')) {
    throw new Error(
      'OPENAI_COMPATIBLE_HEADERS must be a valid JSON object with string values',
    )
  }
  return Object.fromEntries(entries) as Record<string, string>
}
