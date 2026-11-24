const MAX_EVENT_BYTES = 8 * 1024 * 1024

export async function* readCompatibleSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let boundary = nextSSEBoundary(buffer)
      while (boundary) {
        const event = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        if (Buffer.byteLength(event) > MAX_EVENT_BYTES) throw new Error('Provider SSE event exceeds 8 MiB')
        const data = sseData(event)
        if (data === '[DONE]') return
        if (data) yield data
        boundary = nextSSEBoundary(buffer)
      }
      if (Buffer.byteLength(buffer) > MAX_EVENT_BYTES) throw new Error('Provider SSE event exceeds 8 MiB')
      if (done) {
        const data = sseData(buffer)
        if (data && data !== '[DONE]') yield data
        return
      }
    }
  } finally {
    try { await reader.cancel() } catch { /* The fetch may already have aborted. */ }
    reader.releaseLock()
  }
}

function nextSSEBoundary(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (lf === -1) return { index: crlf, length: 4 }
  if (crlf === -1) return { index: lf, length: 2 }
  return crlf < lf ? { index: crlf, length: 4 } : { index: lf, length: 2 }
}

function sseData(event: string): string {
  return event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim()
}
