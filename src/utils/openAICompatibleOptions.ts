export type OpenAICompatibleProviderOptions = {
  apiMode?: 'auto' | 'chat-completions' | 'responses'
  headers?: Record<string, string>
  timeoutMs?: number
  chatCompletionsPath?: string
  responsesPath?: string
  modelsPath?: string
  streamOptions?: boolean
  samplingParams?: boolean
  maxCompletionTokens?: boolean
  parameterFallback?: boolean
  schemaFallback?: boolean
}

const BOOLEAN_OPTIONS = ['streamOptions', 'samplingParams', 'maxCompletionTokens', 'parameterFallback', 'schemaFallback'] as const
const PATH_OPTIONS = ['chatCompletionsPath', 'responsesPath', 'modelsPath'] as const
const OPTION_NAMES = new Set<string>(['apiMode', 'headers', 'timeoutMs', ...BOOLEAN_OPTIONS, ...PATH_OPTIONS])

export function parseOpenAICompatibleOptions(raw: unknown, strict = false): OpenAICompatibleProviderOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Provider options must be a JSON object')
  const value = raw as Record<string, unknown>
  if (strict && Object.keys(value).some(key => !OPTION_NAMES.has(key))) throw new Error('Unknown provider option; check the supported option names')
  const out: OpenAICompatibleProviderOptions = {}
  if (value.apiMode !== undefined) {
    if (typeof value.apiMode !== 'string' || !['auto', 'chat-completions', 'responses'].includes(value.apiMode)) throw new Error('apiMode must be auto, chat-completions, or responses')
    out.apiMode = value.apiMode as OpenAICompatibleProviderOptions['apiMode']
  }
  if (value.headers !== undefined) {
    if (!value.headers || typeof value.headers !== 'object' || Array.isArray(value.headers) || Object.values(value.headers).some(v => typeof v !== 'string')) throw new Error('Provider headers must be an object with string values')
    try { new Headers(value.headers as Record<string, string>) } catch { throw new Error('Provider headers contain an invalid header name or value') }
    out.headers = { ...value.headers as Record<string, string> }
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0) throw new Error('timeoutMs must be a positive integer')
    out.timeoutMs = value.timeoutMs
  }
  for (const key of BOOLEAN_OPTIONS) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'boolean') throw new Error(`${key} must be a boolean`)
      out[key] = value[key]
    }
  }
  for (const key of PATH_OPTIONS) {
    if (value[key] !== undefined) out[key] = parseOpenAICompatiblePath(value[key])
  }
  return out
}

function parseOpenAICompatiblePath(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('OpenAI-compatible endpoint paths must be strings')
  const path = raw.trim()
  if (!path.startsWith('/') || path.startsWith('//') || /[\\#\s]/.test(path)) throw new Error('OpenAI-compatible endpoint paths must start with / and cannot contain a host, fragment, whitespace, or backslash')
  return path
}

export function environmentProviderOptions(env: Record<string, string | undefined>): OpenAICompatibleProviderOptions {
  const raw: Record<string, unknown> = {}
  const booleans = {
    streamOptions: 'OPENAI_COMPATIBLE_STREAM_OPTIONS', samplingParams: 'OPENAI_COMPATIBLE_SAMPLING_PARAMS',
    maxCompletionTokens: 'OPENAI_COMPATIBLE_MAX_COMPLETION_TOKENS', parameterFallback: 'OPENAI_COMPATIBLE_PARAMETER_FALLBACK', schemaFallback: 'OPENAI_COMPATIBLE_SCHEMA_FALLBACK',
  }
  for (const [key, name] of Object.entries(booleans)) {
    if (env[name] !== undefined) raw[key] = booleanEnvironmentValue(env[name]!, name)
  }
  if (env.OPENAI_COMPATIBLE_USE_RESPONSES !== undefined) raw.apiMode = booleanEnvironmentValue(env.OPENAI_COMPATIBLE_USE_RESPONSES, 'OPENAI_COMPATIBLE_USE_RESPONSES') ? 'responses' : 'chat-completions'
  if (env.OPENAI_COMPATIBLE_API_MODE !== undefined) raw.apiMode = env.OPENAI_COMPATIBLE_API_MODE
  const strings = { chatCompletionsPath: 'OPENAI_COMPATIBLE_CHAT_COMPLETIONS_PATH', responsesPath: 'OPENAI_COMPATIBLE_RESPONSES_PATH', modelsPath: 'OPENAI_COMPATIBLE_MODELS_PATH' }
  for (const [key, name] of Object.entries(strings)) if (env[name] !== undefined) raw[key] = env[name]
  const timeout = env.OPENAI_COMPATIBLE_TIMEOUT_MS || env.API_TIMEOUT_MS
  if (timeout) raw.timeoutMs = Number(timeout)
  if (env.OPENAI_COMPATIBLE_HEADERS !== undefined) {
    try { raw.headers = JSON.parse(env.OPENAI_COMPATIBLE_HEADERS) } catch { throw new Error('OPENAI_COMPATIBLE_HEADERS must be a valid JSON object with string values') }
  }
  return parseOpenAICompatibleOptions(raw, true)
}

function booleanEnvironmentValue(raw: string, name: string): boolean {
  const value = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  throw new Error(`${name} must be a boolean`)
}

export function parseOpenAICompatibleOptionsJSON(raw: string): OpenAICompatibleProviderOptions {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('Advanced provider settings must be valid JSON') }
  return parseOpenAICompatibleOptions(value, true)
}
