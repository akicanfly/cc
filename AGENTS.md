# AGENTS.md — Custom CC Build with OpenAI Compatibility

## What This Is

This is a **custom rebuild of `@anthropic-ai/claude-code` v2.1.88** that replaces the original Node.js bundle with a **Bun-based build** targeting any **OpenAI-compatible API provider**. The `cc` CLI binary forwards all requests through an Anthropic-to-OpenAI protocol adapter instead of calling `api.anthropic.com`.

## Build

```
bun run build          # bundles dist/cli.js (~10.7 MB)
bun run build:compile  # produces standalone binary dist/bin/cc
```

## OpenAI Compatibility Layer

The adapter creates a fake Anthropic SDK client that translates Anthropic API calls into OpenAI Chat Completions format. Key mappings:

- `POST /v1/chat/completions` replaces `POST /v1/messages`
- Anthropic `input_schema` → OpenAI `parameters` on tools
- `tool_choice: "any"` → `tool_choice: "required"`
- Thinking blocks → `reasoning_content` delta fields
- SSE stream chunks translated event-by-event
- `prompt_tokens` / `completion_tokens` → `input_tokens` / `output_tokens`
- `finish_reason: "length"` → `stop_reason: "max_tokens"`, `"tool_calls"` → `"tool_use"`
- Textual tool calls (e.g. `Tool call Name: {...}`) parsed as fallback
- Native `reasoning_effort` supported
- Provider quirks handled (Mistral: no `stream_options`; o-series/GPT-5: no `temperature`/`top_p`)
- `GET /models` for model discovery

## Environment Variables

Set `OPENAI_COMPATIBLE_BASE_URL` (or `OPENAI_BASE_URL`) and `OPENAI_COMPATIBLE_API_KEY` (or `OPENAI_API_KEY`). Optionally set `OPENAI_COMPATIBLE_HEADERS`, `OPENAI_COMPATIBLE_TIMEOUT_MS`, `OPENAI_COMPATIBLE_STREAM_OPTIONS`, or `OPENAI_COMPATIBLE_SAMPLING_PARAMS`.

## Stubbed SDK Dependencies

Heavy cloud SDKs (AWS Bedrock, Azure Foundry, GCP Vertex, OpenTelemetry, MCP bridge, sandbox runtime, Chrome MCP) are replaced with error-throwing stubs for a lean build.

## USER_TYPE Gates

`process.env.USER_TYPE === 'ant'` gates 250+ internal-only features across 80+ files (documented in `ANT.md`).
