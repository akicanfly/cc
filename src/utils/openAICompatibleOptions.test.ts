import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getOpenAICompatibleProfiles, requireOpenAICompatibleConfig, saveOpenAICompatibleProfiles } from './openAICompatibleConfig.js'
import { parseOpenAICompatibleOptions, parseOpenAICompatibleOptionsJSON } from './openAICompatibleOptions.js'
const original = { ...process.env }
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccc-profile-options-'))
  for (const key of Object.keys(process.env)) if (/^(OPENAI_|OPENAI_COMPATIBLE_|API_TIMEOUT_MS)/.test(key)) delete process.env[key]
  process.env.CLAUDE_CONFIG_DIR = dir
})
afterEach(() => { process.env = { ...original }; rmSync(dir, { recursive: true, force: true }) })

describe('saved provider options', () => {
  test('round-trips isolated settings for each profile and permits explicit false', () => {
    const profiles = [
      { name: 'one', baseURL: 'https://one.example/v1', apiMode: 'responses' as const, headers: { 'X-Account': 'one' }, timeoutMs: 1234, responsesPath: '/custom/responses', schemaFallback: true, samplingParams: false },
      { name: 'two', baseURL: 'https://two.example/v1', apiMode: 'chat-completions' as const, streamOptions: false, parameterFallback: false },
    ]
    saveOpenAICompatibleProfiles({ version: 1, activeProfile: 'one', profiles })
    expect(requireOpenAICompatibleConfig()).toMatchObject({ apiMode: 'responses', timeoutMs: 1234, headers: { 'x-account': 'one' }, schemaFallback: true, samplingParams: false })
    saveOpenAICompatibleProfiles({ ...getOpenAICompatibleProfiles(), activeProfile: 'two' })
    expect(requireOpenAICompatibleConfig()).toMatchObject({ apiMode: 'chat-completions', streamOptions: false, parameterFallback: false, headers: {} })
    expect(requireOpenAICompatibleConfig().schemaFallback).toBeUndefined()
    expect(getOpenAICompatibleProfiles().profiles).toEqual(profiles)
  })
  test('environment overrides options without leaking headers or credentials from another provider', () => {
    saveOpenAICompatibleProfiles({ version: 1, activeProfile: 'one', profiles: [{ name: 'one', baseURL: 'https://one.example/v1', apiKey: 'private', headers: { Authorization: 'Bearer private' }, apiMode: 'responses', timeoutMs: 1234 }] })
    process.env.OPENAI_COMPATIBLE_SCHEMA_FALLBACK = 'false'
    process.env.OPENAI_COMPATIBLE_USE_RESPONSES = 'false'
    expect(requireOpenAICompatibleConfig()).toMatchObject({ apiMode: 'chat-completions', schemaFallback: false, timeoutMs: 1234 })
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:8080/v1'
    expect(requireOpenAICompatibleConfig().headers).toEqual({})
    expect(requireOpenAICompatibleConfig().apiKey).toBeUndefined()
    expect(requireOpenAICompatibleConfig().timeoutMs).toBe(600000)
  })
  test('validates saved and environment options with useful errors', () => {
    for (const options of [{ schemaFallback: 'yes' }, { apiMode: 'gemini' }, { timeoutMs: 0 }, { headers: { key: 1 } }, { modelsPath: 'https://other.example' }]) expect(() => parseOpenAICompatibleOptions(options)).toThrow()
    expect(() => parseOpenAICompatibleOptions({ misspelled: true }, true)).toThrow('Unknown provider option')
    expect(() => parseOpenAICompatibleOptionsJSON('{private-header-secret')).toThrow('Advanced provider settings must be valid JSON')
    process.env.OPENAI_COMPATIBLE_STREAM_OPTIONS = 'sometimes'
    expect(() => requireOpenAICompatibleConfig()).toThrow('must be a boolean')
  })
})
