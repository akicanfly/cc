import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getOpenAICompatibleConfig,
  getOpenAICompatibleConfigPath,
  getOpenAICompatibleProfiles,
  getActiveOpenAICompatibleProviderName,
  getStoredOpenAICompatibleConfig,
  getStoredOpenAICompatibleProfiles,
  isOpenAICompatibleConfigured,
  requireOpenAICompatibleConfig,
  saveOpenAICompatibleConfig,
  saveOpenAICompatibleProfiles,
  subscribeToOpenAICompatibleConfig,
} from './openAICompatibleConfig.js'

const originalEnv = { ...process.env }
let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'ccc-provider-test-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
  process.env = { ...originalEnv }
})

describe('OpenAI-compatible configuration', () => {
  test('supports standard OpenAI aliases and trims trailing slashes', () => {
    delete process.env.OPENAI_COMPATIBLE_BASE_URL
    delete process.env.OPENAI_COMPATIBLE_API_KEY
    process.env.OPENAI_BASE_URL = 'https://provider.example/v1///'
    process.env.OPENAI_API_KEY = 'key'

    expect(isOpenAICompatibleConfigured()).toBe(true)
    expect(requireOpenAICompatibleConfig().baseURL).toBe(
      'https://provider.example/v1',
    )
  })

  test('rejects invalid timeout and header configuration', () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://provider.example/v1'
    process.env.OPENAI_COMPATIBLE_API_KEY = 'key'
    process.env.OPENAI_COMPATIBLE_TIMEOUT_MS = 'never'
    expect(() => getOpenAICompatibleConfig()).toThrow('positive integer')

    delete process.env.OPENAI_COMPATIBLE_TIMEOUT_MS
    process.env.OPENAI_COMPATIBLE_HEADERS = '{"x-number":1}'
    expect(() => getOpenAICompatibleConfig()).toThrow('string values')
  })

  test('supports providers without API keys and falls back to OpenCode Zen', () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:11434/v1'
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_COMPATIBLE_API_KEY
    delete process.env.OPENAI_API_KEY

    expect(isOpenAICompatibleConfigured()).toBe(true)
    expect(requireOpenAICompatibleConfig().apiKey).toBeUndefined()

    delete process.env.OPENAI_COMPATIBLE_BASE_URL
    delete process.env.OPENAI_BASE_URL

    expect(isOpenAICompatibleConfigured()).toBe(true)
    expect(requireOpenAICompatibleConfig()).toMatchObject({
      baseURL: 'https://opencode.ai/zen/v1',
      apiKey: undefined,
    })
    expect(getOpenAICompatibleProfiles()).toEqual({
      version: 1,
      activeProfile: 'opencode',
      profiles: [
        { name: 'opencode', baseURL: 'https://opencode.ai/zen/v1' },
      ],
    })
    expect(getActiveOpenAICompatibleProviderName()).toBe('opencode')
  })

  test('persists provider credentials with private file permissions', () => {
    delete process.env.OPENAI_COMPATIBLE_BASE_URL
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_COMPATIBLE_API_KEY
    delete process.env.OPENAI_API_KEY

    saveOpenAICompatibleConfig({
      baseURL: 'https://provider.example/v1/',
      apiKey: 'saved-key',
    })

    expect(getStoredOpenAICompatibleConfig()).toEqual({
      baseURL: 'https://provider.example/v1',
      apiKey: 'saved-key',
    })
    expect(requireOpenAICompatibleConfig().apiKey).toBe('saved-key')
    expect(statSync(getOpenAICompatibleConfigPath()).mode & 0o777).toBe(0o600)
    expect(readFileSync(getOpenAICompatibleConfigPath(), 'utf8')).not.toContain(
      'undefined',
    )
  })

  test('environment variables override saved provider credentials', () => {
    saveOpenAICompatibleConfig({
      baseURL: 'https://saved.example/v1',
      apiKey: 'saved-key',
    })
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://env.example/v1'
    process.env.OPENAI_COMPATIBLE_API_KEY = 'env-key'

    expect(requireOpenAICompatibleConfig()).toMatchObject({
      baseURL: 'https://env.example/v1',
      apiKey: 'env-key',
    })
  })

  test('does not mix saved credentials with an environment provider', () => {
    saveOpenAICompatibleConfig({
      baseURL: 'https://saved.example/v1',
      apiKey: 'saved-key',
    })
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://env.example/v1'
    delete process.env.OPENAI_COMPATIBLE_API_KEY
    delete process.env.OPENAI_API_KEY

    expect(requireOpenAICompatibleConfig()).toMatchObject({
      baseURL: 'https://env.example/v1',
      apiKey: undefined,
    })
  })

  test('reports malformed saved configuration instead of ignoring it', () => {
    writeFileSync(getOpenAICompatibleConfigPath(), '{not-json')

    expect(() => getStoredOpenAICompatibleConfig()).toThrow('invalid JSON')
    expect(() => getOpenAICompatibleConfig()).toThrow('invalid JSON')
  })

  test('rejects invalid saved base URLs', () => {
    expect(() =>
      saveOpenAICompatibleConfig({ baseURL: 'file:///tmp/provider' }),
    ).toThrow('must use HTTP or HTTPS')
  })

  test('stores multiple profiles and resolves the active profile', () => {
    delete process.env.OPENAI_COMPATIBLE_BASE_URL
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_COMPATIBLE_API_KEY
    delete process.env.OPENAI_API_KEY
    saveOpenAICompatibleProfiles({
      version: 1,
      activeProfile: 'local',
      profiles: [
        {
          name: 'cloud',
          baseURL: 'https://provider.example/v1',
          apiKey: 'cloud-key',
        },
        { name: 'local', baseURL: 'http://localhost:11434/v1' },
      ],
    })

    expect(requireOpenAICompatibleConfig()).toMatchObject({
      baseURL: 'http://localhost:11434/v1',
      apiKey: undefined,
    })
    expect(getActiveOpenAICompatibleProviderName()).toBe('local')
  })

  test('notifies subscribers when the active profile changes', () => {
    let notifications = 0
    const unsubscribe = subscribeToOpenAICompatibleConfig(() => {
      notifications += 1
    })

    saveOpenAICompatibleProfiles({
      version: 1,
      activeProfile: 'first',
      profiles: [{ name: 'first', baseURL: 'https://first.example/v1' }],
    })
    unsubscribe()
    saveOpenAICompatibleProfiles({
      version: 1,
      activeProfile: 'second',
      profiles: [{ name: 'second', baseURL: 'https://second.example/v1' }],
    })

    expect(notifications).toBe(1)
  })

  test('derives an environment provider label from its hostname', () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'https://api.openrouter.ai/v1'

    expect(getActiveOpenAICompatibleProviderName()).toBe('openrouter')
  })

  test('migrates the original single-provider format in memory', () => {
    writeFileSync(
      getOpenAICompatibleConfigPath(),
      JSON.stringify({
        baseURL: 'https://legacy.example/v1',
        apiKey: 'legacy-key',
      }),
    )

    expect(getStoredOpenAICompatibleProfiles()).toEqual({
      version: 1,
      activeProfile: 'default',
      profiles: [
        {
          name: 'default',
          baseURL: 'https://legacy.example/v1',
          apiKey: 'legacy-key',
        },
      ],
    })
  })

  test('rejects duplicate and missing active profiles', () => {
    expect(() =>
      saveOpenAICompatibleProfiles({
        version: 1,
        activeProfile: 'missing',
        profiles: [{ name: 'one', baseURL: 'https://one.example/v1' }],
      }),
    ).toThrow('active provider profile must exist')

    expect(() =>
      saveOpenAICompatibleProfiles({
        version: 1,
        activeProfile: 'same',
        profiles: [
          { name: 'same', baseURL: 'https://one.example/v1' },
          { name: 'same', baseURL: 'https://two.example/v1' },
        ],
      }),
    ).toThrow('must be unique')
  })
})
