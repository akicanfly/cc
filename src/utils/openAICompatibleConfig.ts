import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'

export type OpenAICompatibleConfig = {
  baseURL: string
  apiKey?: string
  headers: Record<string, string>
  timeoutMs: number
}

const DEFAULT_TIMEOUT_MS = 600_000
const CONFIG_FILENAME = 'openai-compatible.json'
const DEFAULT_PROVIDER_PROFILE: OpenAICompatibleProviderProfile = {
  name: 'opencode',
  baseURL: 'https://opencode.ai/zen/v1',
}
const configChangeListeners = new Set<() => void>()
let configVersion = 0

export type StoredOpenAICompatibleConfig = {
  baseURL: string
  apiKey?: string
}

export type OpenAICompatibleProviderProfile = StoredOpenAICompatibleConfig & {
  name: string
}

export type OpenAICompatibleProviderProfiles = {
  version: 1
  activeProfile: string
  profiles: OpenAICompatibleProviderProfile[]
}

export function getOpenAICompatibleConfigPath(): string {
  return join(getClaudeConfigHomeDir(), CONFIG_FILENAME)
}

export function subscribeToOpenAICompatibleConfig(
  listener: () => void,
): () => void {
  configChangeListeners.add(listener)
  return () => configChangeListeners.delete(listener)
}

export function getOpenAICompatibleConfigVersion(): number {
  return configVersion
}

export function getActiveOpenAICompatibleProviderName(): string | undefined {
  const envBaseURL = getEnvBaseURL()
  if (envBaseURL) return providerNameFromURL(envBaseURL)
  return getOpenAICompatibleProfiles().activeProfile
}

export function getOpenAICompatibleProfiles(): OpenAICompatibleProviderProfiles {
  return getStoredOpenAICompatibleProfiles() ?? {
    version: 1,
    activeProfile: DEFAULT_PROVIDER_PROFILE.name,
    profiles: [{ ...DEFAULT_PROVIDER_PROFILE }],
  }
}

export function getStoredOpenAICompatibleProfiles():
  | OpenAICompatibleProviderProfiles
  | undefined {
  const configPath = getOpenAICompatibleConfigPath()
  let contents: string
  try {
    contents = readFileSync(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new Error(`Unable to read OpenAI-compatible config at ${configPath}`, {
      cause: error,
    })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents) as unknown
  } catch (error) {
    throw new Error(
      `OpenAI-compatible config at ${configPath} contains invalid JSON`,
      { cause: error },
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `OpenAI-compatible config at ${configPath} must be a JSON object`,
    )
  }

  const value = parsed as Record<string, unknown>
  // Migrate the original single-provider format in memory. It is rewritten in
  // the versioned format the next time the user changes provider settings.
  if (typeof value.baseURL === 'string') {
    const profile = parseProfile(
      { name: 'default', baseURL: value.baseURL, apiKey: value.apiKey },
      configPath,
    )
    return { version: 1, activeProfile: profile.name, profiles: [profile] }
  }

  if (
    value.version !== 1 ||
    typeof value.activeProfile !== 'string' ||
    !Array.isArray(value.profiles) ||
    value.profiles.length === 0
  ) {
    throw new Error(
      `OpenAI-compatible config at ${configPath} has an invalid profile structure`,
    )
  }

  const profiles = value.profiles.map(profile =>
    parseProfile(profile, configPath),
  )
  const names = new Set(profiles.map(profile => profile.name))
  if (names.size !== profiles.length) {
    throw new Error(
      `OpenAI-compatible config at ${configPath} contains duplicate profile names`,
    )
  }
  if (!names.has(value.activeProfile)) {
    throw new Error(
      `OpenAI-compatible config at ${configPath} refers to a missing active profile`,
    )
  }
  return { version: 1, activeProfile: value.activeProfile, profiles }
}

export function getStoredOpenAICompatibleConfig():
  | StoredOpenAICompatibleConfig
  | undefined {
  const stored = getStoredOpenAICompatibleProfiles()
  const active = stored?.profiles.find(
    profile => profile.name === stored.activeProfile,
  )
  if (!active) return
  return { baseURL: active.baseURL, apiKey: active.apiKey }
}

export function saveOpenAICompatibleProfiles(
  config: OpenAICompatibleProviderProfiles,
): void {
  const profiles = config.profiles.map(profile =>
    parseProfile(profile, getOpenAICompatibleConfigPath()),
  )
  if (profiles.length === 0) {
    throw new Error('At least one provider profile is required')
  }
  if (new Set(profiles.map(profile => profile.name)).size !== profiles.length) {
    throw new Error('Provider profile names must be unique')
  }
  if (!profiles.some(profile => profile.name === config.activeProfile)) {
    throw new Error('The active provider profile must exist')
  }
  const configDir = getClaudeConfigHomeDir()
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  writeFileSync(
    getOpenAICompatibleConfigPath(),
    `${JSON.stringify({ version: 1, activeProfile: config.activeProfile, profiles }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
  chmodSync(getOpenAICompatibleConfigPath(), 0o600)
  configVersion += 1
  for (const listener of configChangeListeners) listener()
}

export function saveOpenAICompatibleConfig(
  config: StoredOpenAICompatibleConfig,
): void {
  saveOpenAICompatibleProfiles({
    version: 1,
    activeProfile: 'default',
    profiles: [{ name: 'default', ...config }],
  })
}

export function isOpenAICompatibleConfigured(): boolean {
  return !!getEnvBaseURL() || !!getActiveProfileConfig()?.baseURL
}

export function getOpenAICompatibleConfig(): OpenAICompatibleConfig | undefined {
  const envBaseURL = getEnvBaseURL()
  // A provider selected through the environment must not accidentally inherit
  // credentials saved for a different provider.
  const profileConfig = envBaseURL ? undefined : getActiveProfileConfig()
  const baseURL = envBaseURL || profileConfig?.baseURL
  const apiKey =
    process.env.OPENAI_COMPATIBLE_API_KEY ||
    process.env.OPENAI_API_KEY ||
    profileConfig?.apiKey
  if (!baseURL) return undefined

  const validatedBaseURL = validateBaseURL(baseURL)

  return {
    baseURL: validatedBaseURL,
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

function getEnvBaseURL(): string | undefined {
  return (
    process.env.OPENAI_COMPATIBLE_BASE_URL ||
    process.env.OPENAI_BASE_URL
  )?.trim()
}

function getActiveProfileConfig(): StoredOpenAICompatibleConfig | undefined {
  const profiles = getOpenAICompatibleProfiles()
  const active = profiles.profiles.find(
    profile => profile.name === profiles.activeProfile,
  )
  if (!active) return
  return { baseURL: active.baseURL, apiKey: active.apiKey }
}

function validateBaseURL(baseURL: string): string {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    throw new Error('OpenAI-compatible provider requires a valid base URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OpenAI-compatible base URL must use HTTP or HTTPS')
  }
  return baseURL.trim().replace(/\/+$/, '')
}

function providerNameFromURL(baseURL: string): string {
  const hostname = new URL(validateBaseURL(baseURL)).hostname.toLowerCase()
  const withoutAPIPrefix = hostname.replace(/^api\./, '')
  return withoutAPIPrefix.split('.')[0] || hostname
}

function parseProfile(
  raw: unknown,
  configPath: string,
): OpenAICompatibleProviderProfile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `OpenAI-compatible config at ${configPath} has an invalid profile`,
    )
  }
  const profile = raw as Record<string, unknown>
  if (typeof profile.name !== 'string' || !profile.name.trim()) {
    throw new Error(
      `OpenAI-compatible config at ${configPath} has a profile without a name`,
    )
  }
  const name = profile.name.trim()
  if (name.length > 64 || /[\x00-\x1f\x7f]/.test(name)) {
    throw new Error(
      `OpenAI-compatible config at ${configPath} has an invalid profile name`,
    )
  }
  if (typeof profile.baseURL !== 'string' || !profile.baseURL.trim()) {
    throw new Error(
      `OpenAI-compatible config at ${configPath} has a profile without a baseURL`,
    )
  }
  if (profile.apiKey !== undefined && typeof profile.apiKey !== 'string') {
    throw new Error(
      `OpenAI-compatible config at ${configPath} has a profile with an invalid apiKey`,
    )
  }
  return {
    name,
    baseURL: validateBaseURL(profile.baseURL),
    ...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
  }
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
