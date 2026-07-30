import { describe, expect, test } from 'bun:test'
import {
  shouldSendOpenAISamplingParams,
  shouldSendOpenAIStreamOptions,
  shouldUseMaxCompletionTokens,
} from './openaiCompatibleQuirks.js'

describe('OpenAI-compatible provider quirks', () => {
  test('suppresses unsupported Mistral stream options', () => {
    expect(shouldSendOpenAIStreamOptions('https://api.mistral.ai/v1', {})).toBe(
      false,
    )
    expect(
      shouldSendOpenAIStreamOptions('https://provider.example/v1', {}),
    ).toBe(true)
  })

  test('recognizes namespaced GPT-5 and o-series models', () => {
    expect(shouldUseMaxCompletionTokens('openai/gpt-5', {})).toBe(true)
    expect(shouldUseMaxCompletionTokens('provider/o3-mini', {})).toBe(true)
    expect(shouldSendOpenAISamplingParams('gpt-5-mini', {})).toBe(false)
    expect(shouldSendOpenAISamplingParams('openai/gpt-5-mini', {})).toBe(false)
    expect(shouldSendOpenAISamplingParams('o3', {})).toBe(false)
    expect(shouldUseMaxCompletionTokens('qwen3-coder', {})).toBe(false)
  })

  test('honors explicit provider overrides', () => {
    expect(
      shouldSendOpenAIStreamOptions('https://api.mistral.ai/v1', {
        OPENAI_COMPATIBLE_STREAM_OPTIONS: 'true',
      }),
    ).toBe(true)
    expect(
      shouldUseMaxCompletionTokens('gpt-5', {
        OPENAI_COMPATIBLE_MAX_COMPLETION_TOKENS: 'false',
      }),
    ).toBe(false)
  })
})
