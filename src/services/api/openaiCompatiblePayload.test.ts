import { describe, expect, test } from 'bun:test'
import { compatibleReasoning, compatibleText, compatibleUsage, readCompatibleJSON } from './openaiCompatiblePayload.js'
import { reasoningDetails } from './openaiCompatibleReasoning.js'

describe('compatible payload dialects', () => {
  test('reads text and Mistral thinking blocks separately', () => {
    const content = [{ type: 'thinking', thinking: [{ type: 'text', text: 'reason' }] }, { type: 'text', text: 'answer' }]
    expect(compatibleText(content)).toBe('answer')
    expect(compatibleReasoning({ content })).toBe('reason')
    expect(compatibleReasoning({ reasoning_content: '', reasoning: 'fallback' })).toBe('fallback')
  })

  test.each(['cached_tokens', 'prompt_cache_hit_tokens'])('reads %s cache usage', key => {
    expect(compatibleUsage({ prompt_tokens: 100, completion_tokens: 10, [key]: 30 })).toEqual({
      input_tokens: 70, output_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: 0,
    })
  })

  test('handles Responses cached usage and bounds invalid counts', () => {
    expect(compatibleUsage({ input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 100 } })).toEqual({
      input_tokens: 0, output_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 0,
    })
    expect(compatibleUsage({ prompt_tokens: NaN, completion_tokens: -1 }).input_tokens).toBe(0)
  })

  test('rejects HTTP 200 error envelopes and malformed JSON', async () => {
    for (const payload of [{ error: { message: 'bad key' } }, { error: 'bad key' }, { base_resp: { status_code: 1004, status_msg: 'bad key' } }]) {
      await expect(readCompatibleJSON(Response.json(payload))).rejects.toThrow('bad key')
    }
    await expect(readCompatibleJSON(new Response('<html>gateway</html>'))).rejects.toThrow('invalid JSON')
    await expect(readCompatibleJSON(Response.json([]))).rejects.toThrow('non-object')
    expect(await readCompatibleJSON(Response.json({ data: [] }))).toEqual({ data: [] })
  })

  test('validates saved reasoning metadata and ignores unrelated signatures', () => {
    expect(reasoningDetails('native-signature')).toBeUndefined()
    expect(() => reasoningDetails('ccc-openrouter:broken')).toThrow('invalid JSON')
    expect(() => reasoningDetails('ccc-openrouter:[null]')).toThrow('array of objects')
  })
})

describe('HTTP 200 error classification', () => {
  test.each([
    ['invalid_api_key', 401], ['permission_denied', 403], ['invalid_request_error', 400],
    ['context_length_exceeded', 400], ['rate_limit_exceeded', 429], ['server_error', 500],
    ['service_unavailable', 503], ['unrecognized_failure', 400],
  ])('classifies %s without changing the provider code', async (code, status) => {
    await expect(readCompatibleJSON(Response.json({ error: { code, message: 'provider diagnosis', param: 'model' } }, { headers: { 'x-request-id': 'request-1', 'retry-after': '3' } }))).rejects.toMatchObject({ status, requestID: 'request-1', error: { error: expect.objectContaining({ code, param: 'model' }) } })
  })
})
