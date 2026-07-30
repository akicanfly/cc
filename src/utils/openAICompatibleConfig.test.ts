import { afterEach, describe, expect, test } from 'bun:test'
import {
  getOpenAICompatibleConfig,
  isOpenAICompatibleConfigured,
  requireOpenAICompatibleConfig,
} from './openAICompatibleConfig.js'

const originalEnv = { ...process.env }

afterEach(() => {
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

  test('requires a base URL but supports providers without API keys', () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:11434/v1'
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_COMPATIBLE_API_KEY
    delete process.env.OPENAI_API_KEY

    expect(isOpenAICompatibleConfigured()).toBe(true)
    expect(requireOpenAICompatibleConfig().apiKey).toBeUndefined()

    delete process.env.OPENAI_COMPATIBLE_BASE_URL
    delete process.env.OPENAI_BASE_URL

    expect(isOpenAICompatibleConfigured()).toBe(false)
    expect(() => requireOpenAICompatibleConfig()).toThrow(
      'requires OPENAI_COMPATIBLE_BASE_URL',
    )
  })
})
