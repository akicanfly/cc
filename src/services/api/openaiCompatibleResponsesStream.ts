import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'crypto'
import { compatibleUsage } from './openaiCompatiblePayload.js'
import { createOpenAICompatiblePayloadError } from './openaiCompatibleErrors.js'
import { responsesReasoningBlock } from './openaiCompatibleResponsesReasoning.js'
import { readCompatibleSSE } from './openaiCompatibleSSE.js'
import { parseToolInput, validateToolName, isPotentialTextualToolCall, parseTextualToolCall } from './openaiCompatibleTools.js'
import type { ResponsesOutputItem, ResponsesResponse } from './openaiCompatibleResponses.js'

type Event = { type: string; [key: string]: unknown }
type ResponsesEvent = {
  type?: string; output_index?: number; item_id?: string; delta?: unknown; text?: unknown;
  arguments?: unknown; name?: string; item?: ResponsesOutputItem; error?: unknown;
  response?: ResponsesResponse;
}
type Item = ResponsesOutputItem & { emitted?: boolean; textSeen?: boolean }

export function fromResponsesStream(body: ReadableStream<Uint8Array>, params: BetaMessageStreamParams, controller: AbortController, headers = new Headers()) {
  const stream = (async function* (): AsyncGenerator<Event> {
    yield { type: 'message_start', message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: params.model, content: [], stop_reason: null, stop_sequence: null, usage: compatibleUsage() } }
    let next = 0
    let active: { index: number; kind: 'text' | 'thinking'; outputIndex: number } | undefined
    let usage = compatibleUsage()
    let completed = false
    let stopReason = 'end_turn'
    let hadTools = false
    let textualCandidate = ''
    const items = new Map<number, Item>()
    const closedText = new Set<number>()

    function* close(): Generator<Event> {
      if (active) yield { type: 'content_block_stop', index: active.index }
      active = undefined
    }
    function* text(kind: 'text' | 'thinking', value: string, outputIndex: number): Generator<Event> {
      if (!active || active.kind !== kind || active.outputIndex !== outputIndex) {
        yield* close()
        active = { index: next++, kind, outputIndex }
        yield { type: 'content_block_start', index: active.index, content_block: kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' } }
      }
      if (value) yield { type: 'content_block_delta', index: active.index, delta: kind === 'text' ? { type: 'text_delta', text: value } : { type: 'thinking_delta', thinking: value } }
    }
    function* emitTool(item: Item): Generator<Event> {
      if (item.emitted) return
      if (!item.name) throw new Error('Responses tool call did not include a name')
      validateToolName(item.name, params)
      parseToolInput(item.arguments ?? undefined)
      yield* close()
      const index = next++
      yield { type: 'content_block_start', index, content_block: { type: 'tool_use', id: item.call_id ?? item.id ?? `toolu_${randomUUID()}`, name: item.name, input: {} } }
      yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: item.arguments || '{}' } }
      yield { type: 'content_block_stop', index }
      item.emitted = true
      hadTools = true
    }
    function* flushTools(): Generator<Event> {
      for (const [, item] of [...items].sort(([a], [b]) => a - b)) if (item.type === 'function_call' && !item.emitted) yield* emitTool(item)
    }
    function* finishItem(item: Item, index: number): Generator<Event> {
      if (item.emitted) return
      if (item.type === 'function_call') yield* emitTool(item)
      else if (item.type === 'reasoning') {
        yield* flushTools()
        const block = responsesReasoningBlock(item)
        yield* text('thinking', item.textSeen ? '' : String(block.thinking), index)
        yield { type: 'content_block_delta', index: active!.index, delta: { type: 'signature_delta', signature: block.signature } }
        yield* close()
        item.emitted = true
      } else if (item.type === 'message') {
        if (!item.textSeen && !closedText.has(index)) {
          const value = (item.content ?? []).map(part => part.type === 'output_text' ? part.text ?? '' : part.type === 'refusal' ? part.refusal ?? '' : '').join('')
          if (value) {
            yield* flushTools()
            const call = !hadTools ? parseTextualToolCall(value, params) : null
            if (call) yield* emitTool({ type: 'function_call', name: call.name, arguments: JSON.stringify(call.input) })
            else yield* text('text', value, index)
          }
        }
        yield* close()
        closedText.add(index)
        item.emitted = true
      }
    }

    for await (const frame of readCompatibleSSE(body)) {
      let events: ResponsesEvent[]
      try { events = [JSON.parse(frame)] }
      catch {
        try { events = frame.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) }
        catch { throw new Error('Responses stream returned an invalid JSON event') }
      }
      for (const event of events) {
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Responses stream returned a non-object event')
        const kind = typeof event.type === 'string' ? event.type : ''
        if (event.error || kind === 'error') throw createOpenAICompatiblePayloadError({ error: event.error ?? event }, headers, 'Responses stream')
        const index = event.output_index ?? 0
        if (kind === 'response.failed') throw createOpenAICompatiblePayloadError({ error: event.response?.error ?? { message: 'Responses generation failed' } }, headers, 'Responses stream')
        const current = items.get(index) ?? {}
        if (kind === 'response.output_item.added') {
          if (event.item?.type === 'function_call') yield* close()
          items.set(index, { ...current, ...event.item })
        } else if (kind === 'response.function_call_arguments.delta') {
          current.type = 'function_call'
          current.arguments = (current.arguments ?? '') + (typeof event.delta === 'string' ? event.delta : '')
          current.id ??= event.item_id
          items.set(index, current)
        } else if (kind === 'response.function_call_arguments.done') {
          current.type = 'function_call'
          if (typeof event.arguments === 'string') current.arguments = event.arguments
          current.name ??= event.name
          items.set(index, current)
        } else if (['response.output_text.delta', 'response.refusal.delta', 'response.reasoning_summary_text.delta', 'response.reasoning_text.delta'].includes(kind)) {
          yield* flushTools()
          const thinking = kind.includes('reasoning')
          current.type ??= thinking ? 'reasoning' : 'message'
          current.textSeen = true
          items.set(index, current)
          const value = typeof event.delta === 'string' ? event.delta : ''
          if (!thinking && !hadTools && (!active || active.kind !== 'text') && isPotentialTextualToolCall(textualCandidate + value)) {
            textualCandidate += value
          } else {
            if (textualCandidate) { yield* text('text', textualCandidate, index); textualCandidate = '' }
            yield* text(thinking ? 'thinking' : 'text', value, index)
          }
        } else if (kind === 'response.output_text.done' || kind === 'response.refusal.done') {
          if (!current.textSeen && !closedText.has(index) && typeof event.text === 'string') {
            yield* flushTools(); yield* text('text', event.text, index)
            current.textSeen = true; current.type ??= 'message'; items.set(index, current)
          }
        } else if (kind === 'response.output_item.done') {
          const item = { ...current, ...event.item }
          items.set(index, item)
          yield* finishItem(item, index)
        } else if (kind === 'response.completed' || kind === 'response.incomplete') {
          const response = event.response as ResponsesResponse | undefined
          if (response?.error) throw createOpenAICompatiblePayloadError({ error: response.error }, headers, 'Responses stream')
          for (const [i, output] of (response?.output ?? []).entries()) {
            const previous = items.get(i) ?? {}
            const item = { ...previous, ...output }
            items.set(i, item)
            yield* finishItem(item, i)
          }
          if (response?.usage) usage = compatibleUsage(response.usage)
          if (response?.incomplete_details?.reason === 'max_output_tokens') stopReason = 'max_tokens'
          else if (response?.incomplete_details?.reason === 'content_filter') stopReason = 'stop_sequence'
          completed = true
        }
      }
    }
    if (!completed) throw new Error('Responses stream ended before completion')
    yield* close()
    yield* flushTools()
    if (textualCandidate) {
      const call = !hadTools ? parseTextualToolCall(textualCandidate, params) : null
      if (call) yield* emitTool({ type: 'function_call', name: call.name, arguments: JSON.stringify(call.input) })
      else { yield* text('text', textualCandidate, -1); yield* close() }
    }
    yield { type: 'message_delta', delta: { stop_reason: hadTools && stopReason === 'end_turn' ? 'tool_use' : stopReason, stop_sequence: null }, usage }
    yield { type: 'message_stop' }
  })() as AsyncGenerator<Event> & { controller: AbortController }
  stream.controller = controller
  return stream
}
