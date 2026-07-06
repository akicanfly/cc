type EnvLike = Record<string, string | undefined>

const STREAM_OPTIONS_UNSUPPORTED_HOSTS = new Set([
  'api.mistral.ai',
])

export function shouldSendOpenAIStreamOptions(baseURL: string, env: EnvLike = process.env): boolean {
  const override = parseBooleanEnv(env.OPENAI_COMPATIBLE_STREAM_OPTIONS)
  if (override !== undefined) return override

  const host = openAICompatibleHost(baseURL)
  return !STREAM_OPTIONS_UNSUPPORTED_HOSTS.has(host)
}

export function shouldSendOpenAISamplingParams(model: string, env: EnvLike = process.env): boolean {
  const override = parseBooleanEnv(env.OPENAI_COMPATIBLE_SAMPLING_PARAMS)
  if (override !== undefined) return override

  const normalized = model.trim().toLowerCase()
  return !isOpenAIReasoningOnlyModel(normalized)
}

function isOpenAIReasoningOnlyModel(model: string): boolean {
  return /^o\d(?:[-.]|$)/.test(model) || /^gpt-5(?:[-.]|$)/.test(model)
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
