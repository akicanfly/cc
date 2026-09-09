import { describe, expect, test } from 'bun:test'
import {
  resetZenRunSessionId,
  shouldSendOpenAISamplingParams,
  shouldSendOpenAIStreamOptions,
  shouldUseMaxCompletionTokens,
  shouldUseResponsesAPI,
  zenHeaders,
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

describe('Responses routing', () => {
  test('routes the free muse model on Zen to /responses', () => {
    expect(
      shouldUseResponsesAPI(
        'muse-spark-1.3-contributor-free',
        'https://opencode.ai/zen/v1',
        {},
      ),
    ).toBe(true)
    expect(
      shouldUseResponsesAPI(
        'opencode/muse-spark-1.3-contributor-free',
        'https://opencode.ai/zen/v1',
        {},
      ),
    ).toBe(true)
    expect(
      shouldUseResponsesAPI(
        'MUSE-SPARK-1.3-CONTRIBUTOR-FREE',
        'https://opencode.ai/zen/v1',
        {},
      ),
    ).toBe(true)
  })

  test('stays on chat/completions for paid models and other hosts', () => {
    expect(
      shouldUseResponsesAPI('muse-spark-1.3', 'https://opencode.ai/zen/v1', {}),
    ).toBe(false)
    expect(
      shouldUseResponsesAPI(
        'muse-spark-1.3-contributor-free',
        'https://provider.example/v1',
        {},
      ),
    ).toBe(false)
  })

  test('honors an explicit override', () => {
    expect(
      shouldUseResponsesAPI(
        'muse-spark-1.3-contributor-free',
        'https://opencode.ai/zen/v1',
        { OPENAI_COMPATIBLE_USE_RESPONSES: 'false' },
      ),
    ).toBe(false)
    expect(
      shouldUseResponsesAPI('gpt-5', 'https://provider.example/v1', {
        OPENAI_COMPATIBLE_USE_RESPONSES: 'true',
      }),
    ).toBe(true)
  })
})

describe('Zen session headers', () => {
  test('injects session, user-agent, and client headers on Zen', () => {
    resetZenRunSessionId()
    const headers = zenHeaders('https://opencode.ai/zen/v1', {})
    expect(headers['x-opencode-session']).toMatch(/^ses_/)
    expect(headers['User-Agent']).toBe('opencode/1.18.25')
    expect(headers['x-opencode-client']).toBe('cli')
    resetZenRunSessionId()
  })

  test('reuses one session id per run and never overrides user headers', () => {
    resetZenRunSessionId()
    const first = zenHeaders('https://opencode.ai/zen/v1', {})
    const second = zenHeaders('https://opencode.ai/zen/v1', {})
    expect(second['x-opencode-session']).toBe(first['x-opencode-session'])
    const manual = zenHeaders('https://opencode.ai/zen/v1', {
      'x-opencode-session': 'ses_manual',
    })
    expect(manual['x-opencode-session']).toBeUndefined()
    resetZenRunSessionId()
  })

  test('sends nothing on other providers', () => {
    expect(zenHeaders('https://provider.example/v1', {})).toEqual({})
  })
})
