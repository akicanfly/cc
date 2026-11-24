import { expect, test } from 'bun:test'
import { readCompatibleSSE } from './openaiCompatibleSSE.js'

test('DONE terminates and cancels an SSE body even if the provider leaves it open', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"ok":true}\r\n\r\ndata: [DONE]\r\n\r\n')) },
    cancel() { cancelled = true },
  })
  const frames: string[] = []
  for await (const frame of readCompatibleSSE(body)) frames.push(frame)
  expect(frames).toEqual(['{"ok":true}'])
  expect(cancelled).toBe(true)
}, 1000)

test('decodes CRLF boundaries split between chunks without dropping the final event', async () => {
  const chunks = ['data: {"one":1}\r\n\r', '\ndata: {"two":2}\r\n\r\n', 'data: {"three":3}']
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close() } })
  const frames: string[] = []
  for await (const frame of readCompatibleSSE(body)) frames.push(frame)
  expect(frames).toEqual(['{"one":1}', '{"two":2}', '{"three":3}'])
})
