import { randomUUID } from 'crypto'

type EnvLike = Record<string, string | undefined>

const STREAM_OPTIONS_UNSUPPORTED_HOSTS = new Set([
  'api.mistral.ai',
])

export const ZEN_HOST = 'opencode.ai'
export const ZEN_DEFAULT_USER_AGENT = 'opencode/1.18.25'
export const ZEN_DEFAULT_CLIENT = 'cli'
export const RESPONSES_FREE_MODEL = 'muse-spark-1.3-contributor-free'

let runSessionId: string | undefined

export function getZenRunSessionId(): string {
  if (!runSessionId) {
    runSessionId = `ses_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  }
  return runSessionId
}

export function resetZenRunSessionId(): void {
  runSessionId = undefined
}

export function shouldSendOpenAIStreamOptions(baseURL: string, env: EnvLike = process.env): boolean {
  const override = parseBooleanEnv(env.OPENAI_COMPATIBLE_STREAM_OPTIONS)
  if (override !== undefined) return override

  const host = openAICompatibleHost(baseURL)
  return !STREAM_OPTIONS_UNSUPPORTED_HOSTS.has(host)
}

export function shouldSendOpenAISamplingParams(model: string, env: EnvLike = process.env): boolean {
  const override = parseBooleanEnv(env.OPENAI_COMPATIBLE_SAMPLING_PARAMS)
  if (override !== undefined) return override

  const normalized = normalizeModelName(model)
  return !isOpenAIReasoningOnlyModel(normalized)
}

export function shouldUseMaxCompletionTokens(
  model: string,
  env: EnvLike = process.env,
): boolean {
  const override = parseBooleanEnv(env.OPENAI_COMPATIBLE_MAX_COMPLETION_TOKENS)
  if (override !== undefined) return override
  return isOpenAIReasoningOnlyModel(normalizeModelName(model))
}

export function shouldUseResponsesAPI(
  model: string,
  baseURL: string,
  env: EnvLike = process.env,
): boolean {
  const override = parseBooleanEnv(env.OPENAI_COMPATIBLE_USE_RESPONSES)
  if (override !== undefined) return override
  if (openAICompatibleHost(baseURL) !== ZEN_HOST) return false
  return normalizeModelName(model) === RESPONSES_FREE_MODEL
}

export function isZenBaseURL(baseURL: string): boolean {
  return openAICompatibleHost(baseURL) === ZEN_HOST
}

export function zenHeaders(
  baseURL: string,
  existing: Record<string, string>,
): Record<string, string> {
  if (!isZenBaseURL(baseURL)) return {}
  const seen = new Set(Object.keys(existing).map(key => key.toLowerCase()))
  const out: Record<string, string> = {}
  if (!seen.has('x-opencode-session')) {
    out['x-opencode-session'] = getZenRunSessionId()
  }
  if (!seen.has('user-agent')) {
    out['User-Agent'] = ZEN_DEFAULT_USER_AGENT
  }
  if (!seen.has('x-opencode-client')) {
    out['x-opencode-client'] = ZEN_DEFAULT_CLIENT
  }
  return out
}

function isOpenAIReasoningOnlyModel(model: string): boolean {
  return /^o\d(?:[-.]|$)/.test(model) || /^gpt-5(?:[-.]|$)/.test(model)
}

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase().split('/').at(-1) ?? ''
}

function openAICompatibleHost(baseURL: string): string {
  try {
    return new URL(baseURL).host.toLowerCase()
  } catch {
    return ''
  }
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}
