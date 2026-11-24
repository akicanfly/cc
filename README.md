# Claude Code

## Build and install

Build and link the `ccc` command from a checkout:

```sh
bun install
bun run build
bun link
ccc --version
```

Bun 1.3.10 or newer is required.

## Configure a provider

Start `ccc`, then run:

```text
/provider
```

The profile manager can add, edit, delete, and switch between named providers.
Each profile contains an OpenAI-compatible base URL, a masked API key, and optional
provider settings. The
active profile and saved profiles live in `~/.claude/openai-compatible.json`
with user-only permissions. Changes take effect immediately.
Without environment variables or a saved profile, `ccc` defaults to the
keyless `opencode` profile at `https://opencode.ai/zen/v1`.
`OPENAI_COMPATIBLE_BASE_URL` and
`OPENAI_COMPATIBLE_API_KEY` (and their `OPENAI_*` aliases) continue to override
the saved values.

## OpenAI compatibility

Both Chat Completions and Responses are supported. Set
`OPENAI_COMPATIBLE_USE_RESPONSES=true` for a Responses-only provider. The
OpenCode free Muse model selects Responses automatically.

Reasoning-effort controls are omitted from outgoing requests. Reasoning returned
by providers is still displayed and retained in history, including OpenRouter's
opaque reasoning details. Compatibility handling covers Mistral stream options,
GPT-5/o-series and Kimi sampling restrictions, text/thinking content arrays,
DeepSeek/Moonshot cache usage, OpenRouter cache breakpoints and tool routing,
and images returned by tools.

On an explicit HTTP 400/422 rejection, the adapter can remove unsupported
`stream_options`, `temperature`, `top_p`, or `stop`, or switch between
`max_tokens` and `max_completion_tokens` while retaining the limit. Every
adaptation reports the changed option names without logging credentials or
request contents. This is bounded to three fallback attempts within the original
timeout. Set `parameterFallback: false` to disable those adaptations.

Schemas are preserved by default. Schema rewriting requires an explicit
`schemaFallback: true` in the selected profile or
`OPENAI_COMPATIBLE_SCHEMA_FALLBACK=true`. That opt-in allows removal of specifically
rejected schema keywords and bounded resolution of rejected local references.
It can weaken constraints such as `propertyNames` in the wire schema; the original
tool definition stays intact. The fixed Antigravity proxy accepts full JSON
Schemas and does not need this option.

Responses requests use `store: false`, retain encrypted reasoning in conversation
history, and support reasoning/tool/text interleaving. Generation is never
replayed through the non-streaming fallback after a compatible stream starts.
Authentication and invalid-input errors do not retry; rate limits and server
failures retain their classification and provider diagnostics, including errors
returned inside HTTP 200 responses.

### Per-provider settings

The `/provider` form has an optional advanced JSON field after the API key.
Leave it blank to keep existing settings, or enter `{}` to reset them. Input is
hidden because custom headers can contain credentials. Settings are saved with
the profile in the existing private configuration file. For example:

```json
{
  "apiMode": "responses",
  "responsesPath": "/responses",
  "timeoutMs": 120000,
  "headers": { "X-Client": "ccc" },
  "samplingParams": false,
  "schemaFallback": false
}
```

Supported options are `apiMode` (`auto`, `chat-completions`, or `responses`),
`headers`, `timeoutMs`, `chatCompletionsPath`, `responsesPath`, `modelsPath`,
`streamOptions`, `samplingParams`, `maxCompletionTokens`, `parameterFallback`,
and `schemaFallback`. Omit a compatibility toggle to use automatic provider/model
handling. Old profiles remain valid.

Environment options override the selected profile: `OPENAI_COMPATIBLE_API_MODE`,
`OPENAI_COMPATIBLE_HEADERS`, `OPENAI_COMPATIBLE_TIMEOUT_MS`,
`OPENAI_COMPATIBLE_CHAT_COMPLETIONS_PATH`, `OPENAI_COMPATIBLE_RESPONSES_PATH`,
`OPENAI_COMPATIBLE_MODELS_PATH`, `OPENAI_COMPATIBLE_STREAM_OPTIONS`,
`OPENAI_COMPATIBLE_SAMPLING_PARAMS`, `OPENAI_COMPATIBLE_MAX_COMPLETION_TOKENS`,
`OPENAI_COMPATIBLE_PARAMETER_FALLBACK`, and `OPENAI_COMPATIBLE_SCHEMA_FALLBACK`.
`OPENAI_COMPATIBLE_API_MODE` takes precedence over the older
`OPENAI_COMPATIBLE_USE_RESPONSES` toggle. A base URL selected through the environment
does not inherit headers, credentials, or options from a saved provider.

Endpoint paths are appended to the base URL, defaulting to `/chat/completions`,
`/responses`, and `/models`. Paths must start with `/` and stay on the configured
provider. Boolean environment options accept `true`/`false`, `1`/`0`,
`yes`/`no`, or `on`/`off`.

### Verification

`bun test` includes isolated CLI regression tests against a local fake provider.
They build a production bundle and exercise print mode with an MCP schema,
interactive mode with built-in task tools, and complete tool-result conversations
through both OpenAI protocols. They also check that HTTP 200 authentication errors
and partial stream failures do not replay generation. Interactive tests require
Unix PTYs and are skipped on Windows; print-mode tests still run there.

Install the latest stable prebuilt Bun package directly from GitHub Releases:

```sh
bun remove -g ccc-openai-compatible
bun install -g https://github.com/akicanfly/cc/releases/latest/download/ccc.tgz
```

The portable package requires Bun at runtime, runs on every platform supported
by Bun, and does not run lifecycle scripts. Each release also includes
standalone `ccc` binaries for Linux, macOS, and Windows on x64 and ARM64.

## Educational Use Only — Student Notes

I'm a student using this codebase purely for learning. I'm reading through the source and making small experimental modifications just to understand how it works. This is not production code and not meant to be used by anyone else.

## Proprietary Software of Anthropic

This is **proprietary software owned by Anthropic**, not open source. No license is granted by being in this repository.

Forking for personal study is fine. What's **not** okay: redistributing the code, rebranding or white-labeling it, shipping it under a different name, using Anthropic's trademarks, or sublicensing any of it. That's Anthropic's code, not mine to give away.

For the full terms, see: <https://code.claude.com/docs/en/legal-and-compliance>
