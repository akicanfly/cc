# Handoff: Port opencode's thinking-effort architecture to Claude Code

## Goal

Replace Claude Code's current Anthropic-only thinking-effort implementation (which sends `thinking.budget_tokens` for legacy Claude 4 / 4.5 + `output_config.effort` for Opus 4.6 / Sonnet 4.6, gated by `anthropic-beta` headers) with opencode's design: a single **variant** abstraction that the user picks by name (`none` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`), resolved per-model into a **provider-native blob**, and lowered to the wire format per-protocol at request time.

The original user ask that triggered this: *"look at this project [Claude Code at /home/projects/cc] how it handles thinking effort? is it still some anthropic shit or is it working with the openai compatibility implementation?"* → answered (still anthropic-only). Then: *"read opencode src at /home/git/opencode and see how they have this thinking handling, and make a plan to port that to this claude code build. getting rid of the old anthropic thinking shit."* → plan was produced; user then asked for this handoff.

Concrete outcome: when a user runs `cc` against `OPENAI_COMPATIBLE_BASE_URL` (e.g. GLM-5.2, GPT-5, DeepSeek, Qwen), choosing `--effort high` MUST send `reasoning_effort: "high"` on the wire to that OpenAI-compatible backend (today it sends nothing — the `thinking` param is silently dropped at `src/services/api/openaiCompatible.ts:340-357`). And when they're on Anthropic 1P, `--effort high` MUST continue mapping to `output_config.effort: "high"` for Opus 4.6 / Sonnet 4.6, adaptive `{ type: "adaptive" }` thinking for those same models, bare `{ effort }` for Opus 4.5, and `{ type: "enabled", budget_tokens: 16000 }` for legacy Claude 4. The provider-native blob table is the central abstraction; one variant picker drives all transports.

## Current state

**No code changes have been made this session.** `git status` on branch `test` shows `nothing to commit, working tree clean`. Everything in this handoff is investigation + a written plan. The plan was presented to the user and accepted ("good, write all that inna handoff file"), but the implementation has not started.

**Confirmed by direct inspection (not memory):**

- Claude Code's full thinking-handling code lives at:
  - `src/utils/thinking.ts` (162 lines) — `ThinkingConfig` discriminated union (`adaptive` / `enabled+budgetTokens` / `disabled`), `modelSupportsThinking`, `modelSupportsAdaptiveThinking`, `shouldEnableThinkingByDefault`. Sourced from Anthropic SDK Beta Messages API.
  - `src/utils/effort.ts` (329 lines) — separate, higher-level `output_config.effort` knob (`low`/`medium`/`high`/`max`), `modelSupportsEffort`, `modelSupportsMaxEffort`, ` getDefaultEffortForModel`, `resolveAppliedEffort`, `convertEffortValueToLevel`, `toPersistableEffort`, `getEffortEnvOverride`, `getEffortSuffix`, `getDisplayedEffortLevel`, subscriber-tier gating (`isProSubscriber`/`isMaxSubscriber`/`isTeamSubscriber`), GrowthBook flag `tengu_grey_step2`, ant-internal numeric effort path. The two (`thinking.ts` + `effort.ts`) coexist on the same request body today.
  - `src/services/api/claude.ts:1596-1630` — the actual anthropic-native `thinking` block builder. Decides adaptive (`{ type: 'adaptive' }`) vs budget (`{ type: 'enabled', budget_tokens }`). Honors `CLAUDE_CODE_DISABLE_THINKING`, `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING`, `MAX_THINKING_TOKENS` envs. Per-request.
  - `src/services/api/claude.ts:1699-1728` — final request body: includes `thinking`, `output_config: { effort }`, `betas: [...interleaved-thinking-2025-05-14, redact-thinking-2026-02-12, effort-2025-11-24]`, `temperature` (suppressed when thinking on — API requires `temp: 1`).
  - `src/constants/betas.ts:4-20` — beta header constants: `INTERLEAVED_THINKING_BETA_HEADER='interleaved-thinking-2025-05-14'`, `EFFORT_BETA_HEADER='effort-2025-11-24'`, `REDACT_THINKING_BETA_HEADER='redact-thinking-2026-02-12'`, `TASK_BUDGETS_BETA_HEADER='task-budgets-2026-03-13'`.
  - `src/services/api/claude.ts:40-66` — `configureEffortParams()` writes `outputConfig.effort` + pushes `EFFORT_BETA_HEADER`. Ant-internal numeric effort leaks via `extraBodyParams.anthropic_internal.effort_override` at `:457-465` (gated on `process.env.USER_TYPE === 'ant'`).
  - `src/services/api/openaiCompatible.ts:340-357` — `toOpenAIRequest()` builds the OpenAI Chat-completions body. Sends only `model/messages/tools/tool_choice/max_tokens/temperature/top_p/stop_sequences`. **The Anthropic `thinking` param is silently dropped. No `reasoning_effort` is ever set.** This is the central bug.
  - `src/services/api/openaiCompatible.ts:81,101` — the OpenAI-compatible **response** parser already reads `reasoning_content` and `reasoning_tokens` from incoming chunks (for telemetry only) but does nothing with them on the request side.

- Search across the entire Claude Code tree confirms **zero occurrences** of `reasoning_effort`, `reasoningEffort`, or `AnthropicThinking`/`BetaThinkingConfig` anywhere outside the SDK dependency. (Search was run twice — first with both flags `-tts -ttsx` which ripgrep rejected with `unrecognized file type: tsx` because tsx isn't a recognized type; second plain `rg` over the whole tree, which returned exactly one hit on `openaiCompatible.ts:81` for `reasoning_content`.) Reviewing agent should re-run: `cd /home/projects/cc && rg -n "reasoning_effort|reasoningEffort|reasoning_content"` and verify it returns only the one OpenAI-compat telemetry line.

- `ThinkingConfig` is consumed across ~28 source files in `/home/projects/cc`. Confirmed by `rg -l "thinkingConfig|ThinkingConfig"` returning that many files (run output captured). The most-call-site-heavy ones: `src/query.ts`, `src/Tool.ts`, `src/QueryEngine.ts`, `src/main.tsx`, `src/utils/thinking.ts`, `src/services/api/claude.ts`, `src/services/api/withRetry.ts`, `src/services/compact/compact.ts`, `src/cli/print.ts`, `src/entrypoints/sdk/coreSchemas.ts`. A migration away from this type will reach every one of them.

- opencode's design (verified at source) is layer-caked on `LLMRequest.providerOptions: Record<provider, Record<key, any>>`:
  - Per-model variant table: `ProviderTransform.variants(model)` at `/home/git/opencode/packages/opencode/src/provider/transform.ts:894-938` returns `Record<VariantID, providerNativeBlob>`. Each entry is already the wire shape the provider expects — no canonical `effort` field.
  - Variant vocabulary: `/home/git/opencode/packages/llm/src/schema/ids.ts:29-34` — `ReasoningEfforts = ["none","minimal","low","medium","high","xhigh","max"]`.
  - Three Anthropic native blob shapes coexist (verified line by line in `transform.ts:894-938`):
    1. Legacy Claude 3.7 / 4 Sonnet: `{ thinking: { type: "enabled", budgetTokens: 16000 }, ... }` / `{ ... budgetTokens: 31999 }` keyed under variant IDs `"high"` and `"max"`.
    2. Opus 4.5 (bare): `{ effort }` — no `thinking` block at all.
    3. Opus 4.7+ / Sonnet 4.6 / Fable-5 (adaptive): `{ thinking: { type: "adaptive", display: "summarized"? }, effort }`. `display: "summarized"` set only for opus-4.7+ and fable-5 (omitted for sonnet-4.6 — omitted is its default).
  - OpenAI Chat blob: `{ reasoningEffort: variantID, reasoningSummary: "auto", include: ["reasoning.encrypted_content"] }` at `transform.ts:865-892`. (Wire: `body.reasoning_effort` snake-cased by the protocol layer.)
  - Bedrock Converse blob: `reasoningConfig: { type: "enabled" | "adaptive", budgetTokens?, maxReasoningEffort?, display? }` at `:940-985`. (User scope choice: drop this for now — see Constraints.)
  - Gemini blob: `thinkingConfig: { includeThoughts: true, thinkingBudget? }` or `thinkingLevel` at `:647-663`. (Out of scope — no Gemini transport in current Claude Code.)
  - OpenRouter blob: `{ reasoning: { effort } }` at `:731-738`. (Out of scope — no OpenRouter transport.)

- opencode's response-side abstraction is uniform:
  - One `ReasoningPart = { type: "reasoning", text: string, encrypted?: string, providerMetadata?: ProviderMetadata }` content block at `/home/git/opencode/packages/llm/src/schema/messages.ts:169-181`.
  - Three lifecycle events: `reasoning-start` / `reasoning-delta` / `reasoning-end` at `/home/git/opencode/packages/llm/src/schema/events.ts:106-126`. All carry `id` + optional `providerMetadata`. None carry effort — effort is purely request-time.
  - One `Lifecycle` helper at `/home/git/opencode/packages/llm/src/protocols/utils/lifecycle.ts:6-99` — `reasoningStart` / `reasoningDelta` / `reasoningEnd` / `stepStart` / `finish`. Tracks open reasoning/text blocks via `Set<string>`. All four provider parsers funnel through these three primitives.
  - Per-provider stream parsers (verified): Anthropic `anthropic-messages.ts:676-685,707-732,753-770` handles `thinking_delta` / `signature_delta` / `content_block_start thinking` / `content_block_stop`. OpenAI Chat `openai-chat.ts:411-419,386-394` handles `delta.reasoning_content`. OpenAI Responses `openai-responses.ts:616-778` handles per-summary-index reasoning items. Gemini `gemini.ts:388-465` handles `part.thought === true`. Bedrock Converse `bedrock-converse.ts:174-180,503-549` handles `delta.reasoningContent.text`/`signature`.

- Outgoing assistant replay (verified): Anthropic emits `{ type: "thinking", thinking: part.text, signature: part.encrypted ?? providerMetadata.anthropic.signature }` at `anthropic-messages.ts:447-454`. OpenAI Chat hoists reasoning parts to a single `reasoning_content` string at the assistant-message level at `openai-chat.ts:229-260`. DeepSeek special-case at `transform.ts:269-284` re-injects empty reasoning parts on every assistant message. Generic openai-compat workaround at `transform.ts:286-318` lifts multi-block reasoning back into `providerOptions.openaiCompatible[<field>]` (field name per `model.capabilities.interleaved.field`).

- `ANT-ONLY` (Anthropic internal) numeric-effort bypass: confirmed `claude.ts:457-465` gates `process.env.USER_TYPE === 'ant'` to write `extraBodyParams.anthropic_internal.effort_override` instead of `output_config.effort`. This is non-public-API behavior. Documented at `src/services/api/promptCacheBreakDetection.ts:55-60`.

## Files involved

### Claude Code base (`/home/projects/cc`) — to be modified or deleted

- `src/utils/thinking.ts` — has `ThinkingConfig` union, `modelSupportsThinking`, `modelSupportsAdaptiveThinking`, `shouldEnableThinkingByDefault`, ultrathink helpers. To be **deleted** at end of migration; replaced by the new variant resolver + a thin shim during migration.
- `src/utils/effort.ts` — current `output_config.effort` knob (`EFFORT_LEVELS`, `EffortValue`, `resolveAppliedEffort`, `getDefaultEffortForModel`, subscriber-tier gating, ant-internal numeric). To be **rewritten** — keep `resolveAppliedEffort` as the user→variant resolver; everything else folded into the new variant table.
- `src/services/api/claude.ts` — central Anthropic request builder. The block at `:1596-1630` (the `thinking` builder) and `:40-66` (`configureEffortParams`) get replaced by a single call to the new `lowerThinking()`. Lines `:1699-1728` (final payload) stays but sources its values differently.
- `src/services/api/openaiCompatible.ts` — `toOpenAIRequest()` at `:340-357` MUST learn to carry `reasoning_effort` (read from a variant blob, not the Anthropic `thinking` param). Response parser at `:81,101` already understands `reasoning_content` / `reasoning_tokens` — keep but plumb into the new lifecycle.
- `src/constants/betas.ts:4-20` — beta-header constants. Keep `INTERLEAVED_THINKING_BETA_HEADER`, `EFFORT_BETA_HEADER`, `REDACT_THINKING_BETA_HEADER`; only push them when the variant blob requires them.
- `src/utils/model/configs.ts:31-83` — static model configs (canonical names, provider variants). Needs a new optional field `variants?: VariantBlob[]` per entry, OR gets replaced by a new `modelVariants.ts` helper (see Plan question Q3).
- `src/utils/model/providers.ts:4-13` — `APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'`. Keep. Used by the lower-thinking target resolver.
- `src/utils/settings/types.ts:703` — `effortLevel` Zod enum. Needs widening from `low|medium|high|max` to `none|minimal|low|medium|high|xhigh|max` for OpenAI tiers.
- `src/state/AppStateStore.ts:427,565` — `effortValue?: EffortValue`. Type alias follows from the variant enum change.
- `src/commands/effort/effort.tsx` — `/effort` slash command. Render choices from variant table instead of hardcoded `EFFORT_LEVELS`.
- `src/components/EffortIndicator.tsx`, `src/components/EffortCallout.tsx`, `src/components/ModelPicker.tsx`, `src/components/LogoV2/LogoV2.tsx`, `src/components/LogoV2/CondensedLogo.tsx`, `src/components/Spinner.tsx`, `src/components/ThinkingToggle.tsx` — UI surfaces. Switch from hardcoded effort levels to per-model variant lists.
- `src/main.tsx:993-1000,2462-2517,2633,3024` — CLI flag parsing: `--effort` (already exists), `--thinking` (deprecate). Central entrypoint for resolving config → `effortValue`.
- `src/cli/print.ts:2945-2955,3761-3769` — `-p` mode thinking-config build + effort-resolution control response. Same swap.
- `src/query.ts:694`, `src/QueryEngine.ts:145,219,278-279,355,503,1195,1226,1264` — `effortValue`/`thinkingConfig` plumbing. Every `thinkingConfig` reference needs to go through the new variant abstraction.
- `src/Tool.ts:13,165`, `src/utils/sideQuery.ts:175`, `src/utils/forkedAgent.ts:53,98-99`, `src/tools/AgentTool/runAgent.ts:482-496`, `src/tools/SkillTool/SkillTool.ts:832`, `src/services/api/withRetry.ts:123,131,182,406-409`, `src/services/compact/compact.ts:1184`, `src/utils/sideQuestion.ts`, `src/utils/queryContext.ts`, `src/entrypoints/mcp.ts`, `src/screens/ResumeConversation.tsx`, `src/screens/REPL.tsx`, `src/components/agents/generateAgent.ts`, `src/entrypoints/sdk/coreSchemas.ts:69-103,1055-1062,1168-1173`, `src/entrypoints/sdk/runtimeTypes.ts:1`, `src/commands/btw/btw.tsx`, `src/utils/hooks/*`, `src/utils/permissions/yoloClassifier.ts`, `src/services/awaySummary.ts`, `src/tools/WebSearchTool/WebSearchTool.ts` — secondary consumers of `thinkingConfig` / `effortValue`. Each one will need attention during the migration; the `ThinkingConfig` type alias will be removed at the end so typecheck force-flags them all.
- SDK type evidence: `/home/projects/cc/node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts:1141,1637-1651,2042,2088` confirms `thinking` and `output_config.effort` are independently-typed Anthropic SDK fields and both already-in-beta.

### opencode base (`/home/git/opencode`) — for reference, porting source

- `packages/llm/src/schema/ids.ts:29-34` — `ReasoningEfforts` enum.
- `packages/llm/src/schema/messages.ts:169-181` — `ReasoningPart`. Port verbatim.
- `packages/llm/src/schema/messages.ts:271-312` — `LLMRequest` with `providerOptions` map (no canonical `reasoningEffort` field; everything goes in `providerOptions`).
- `packages/llm/src/schema/options.ts:36,74-83` — `ProviderOptions` and `GenerationOptions` (which has NO thinking field).
- `packages/llm/src/schema/events.ts:106-126` — three reasoning events.
- `packages/llm/src/protocols/utils/lifecycle.ts:6-99` — `Lifecycle` helper. Port verbatim.
- `packages/llm/src/protocols/anthropic-messages.ts:149-152` — `AnthropicThinking` wire schema. `:447-454` outgoing assistant replay. `:489-502` `lowerThinking()` (only handles legacy `enabled` shape — we will need to extend for `adaptive` + `effort` + `display`). `:676-685,707-732,753-770` stream parser. Port per scope decision.
- `packages/llm/src/protocols/openai-chat.ts:75,97,143-147,229-260,386-394,411-419` — request/replay/stream wire shapes. Port the `reasoning_effort` writing and `reasoning_content` parsing verbatim.
- `packages/llm/src/protocols/openai-responses.ts:134-139,281-297,344-452,454-474,616-778` — full Responses-API reasoning flow (only needed if we expose `/v1/responses`).
- `packages/llm/src/protocols/bedrock-converse.ts:62-71,137-138,174-180,343-350,417,503-549` — Bedrock reasoning (only if Q1(b)).
- `packages/llm/src/protocols/gemini.ts:33,48,92-95,191-196,290-298,388-465` — Gemini reasoning (out of scope).
- `packages/opencode/src/provider/transform.ts:5,517-525,571-633,647-663,666,683-689,731-738,740-752,819-843,845-863,879-893,894-938,940-985,987-991,993-1008,1014-1024,1030-1062,1067-1222,1257-1305` — the entire variant-blob matrix per model family. Heart of "what does variant `high` mean for model `X` on provider `Y`".
- `packages/opencode/src/provider/transform.ts:269-284,286-318` — DeepSeek special-case + generic openai-compat reasoning_recovery on outgoing assistant messages. Worth porting if our OpenAI-compat users include DeepSeek-style models.
- `packages/opencode/src/provider/provider.ts:1018-1033` — `Provider.Model` schema with `variants: Record<string, Record<string, any>>`.
- `packages/opencode/src/session/llm/request.ts:80-91` — variant merge order: `base defaults` → `model.options` → `agent.options` → **`variant`** (variant wins).
- Test fixtures (golden recordings) at `/home/git/opencode/packages/llm/test/` for reasoning boundary behavior:
  - `provider/anthropic-messages.test.ts:325-387` — thinking-block replay + `thinking_delta` parsing
  - `provider/openai-chat.test.ts:77-91,100-107,475,532-544` — canonical reasoning replay + `providerOptions.openai.reasoningEffort` → wire `body.reasoning_effort === "low"` (this is the test that catches our current bug)
  - `provider/openai-responses.test.ts:558,760-797` — `reasoningEffort: "high"` and `reasoning_summary_text.delta` parsing
  - `provider/gemini.test.ts:288-411` — Gemini `thought: true` parsing (out of scope)
  - `provider/bedrock-converse.test.ts` — Bedrock reasoning (out of scope)
  - `provider/openrouter.test.ts:44` — `anthropic/claude-3.7-sonnet:thinking` model id
  - `provider/tool-runtime.test.ts:481-525` — reasoning in flight alongside tool calls. Definitely worth porting.
  - `provider/recorded-scenarios.ts:206-213,331,409-429` — `encryptedReasoningOptions`, Gemini budget=0 disable, reasoning continuation scenario.

## What's changed this session

Nothing on disk. `git status` returns clean working tree on branch `test`. The only artifacts produced this session are two large route summaries (the Claude Code thinking-effort exploration report and the opencode design breakdown) and the plan text presented to the user. The user accepted the plan and requested this handoff.

Last 5 commits on the current branch (from `git log --oneline -5` — these are someone else's earlier work, NOT this session's):
```
16ac927 auto model fetch
2d8ca1a harden openai compatible adapter
19b872c fixed tool calls shit
e0e6362 added bun dev
3e01a17 deleted outdated build.md
```

Do NOT treat those commits as related to the thinking-effort port — they're a different feature (ModelPicker remote fetching and OpenAI-compatible hardening; see the previous handoff that was at this path until the user deleted it during this session).

## Constraints and things to avoid

- **No new runtime dependencies.** opencode uses `effect` / `@effect/schema` and an `ai-sdk-style` layered architecture. Claude Code does NOT — it uses `zod` and direct fetch against the Anthropic SDK. Port the SHAPE, not the Effect plumbing. Don't pull in `@effect/schema`, `@ai-sdk/anthropic`, etc. We translate opencode's schema/effect patterns into TS types + zod + plain fetch.
- **No Gemini transport, no Bedrock Converse non-Anthropic bodies, no OpenRouter, no Cloudflare AI Gateway.** Those are out of scope. Claude Code today routes 3P (`bedrock`/`vertex`) as Anthropic transport — keep that. (See open Plan question Q1 below.)
- **No non-ant users sending numeric effort** — `anthropic_internal.effort_override` is ANT-ONLY and stays that way (`USER_TYPE === 'ant'` gate preserved). Don't expose it publicly.
- **Don't break `claude-3-*` models that don't support thinking at all.** The `modelSupportsThinking` allowlist maintains `!canonical.includes('claude-3-')` — same gate must keep working post-rewrite.
- **Don't break `MAX_THINKING_TOKENS` / `CLAUDE_CODE_DISABLE_THINKING` / `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` env vars in one PR.** They have existing users. Map them to variant aliases (`MAX_THINKING_TOKENS=N` → `effort=high` with budget=N for legacy models) for at least one release before deprecation.
- **Don't break session stability mid-conversation.** The current code latches `betas` header arrays so prompt-cache doesn't break across turns (see `claude.ts:1655-1657` fast-mode header latch, `:1680-1689` cache-editing header latch). Same latching discipline MUST apply to the new variant-driven beta pushes — switching effort mid-session can change the cache key and re-bill the entire prompt.
- **Don't break the SDK control message `set_max_thinking_tokens`** (`src/entrypoints/sdk/controlSchemas.ts:146-155`) — external SDK clients call it. It must keep a behavior; can be repurposed to map to a variant.
- **Keep the `effortLevel` settings.json key backward-compatible.** Don't bump the schema in a way that rejects existing user settings. Widen the enum, don't narrow it.
- **Don't write to `handoff.md` again until verification.** If you (the next agent) pick this up, re-verify `git status` and the file references before trusting this document — see the verification section.
- **One release of dual-path compatibility**: keep `--thinking` flag, `ThinkingConfig` type alias, `CLAUDE_CODE_DISABLE_THINKING` env as shims onto the new variant system for one release. Cut after.
- Do NOT commit anything until the user explicitly asks. (Standard opencode rule.)

## What's been tried and failed

Nothing has been tried yet — this is the planning stage. Recorded here only to be explicit that the absence of failures doesn't mean "go ahead and try anything"; it means no experimental code has run against this codebase this session.

## Other learnings

- **Anthropic does NOT break reasoning tokens out of `output_tokens`** in responses. This is an Anthropic-side limitation. opencode documents it at `/home/git/opencode/packages/llm/src/schema/events.ts:42-44` and Anthropic parser at `anthropic-messages.ts:563-578` leaves `reasoningTokens = undefined`, so `outputTokens` carries the combined total. OpenAI-compat providers DO break it out (`completion_tokens_details.reasoning_tokens`). Plan UI/telemetry accordingly — different `Usage.reasoningTokens` semantics per provider.
- **OpenAI `gpt-5*-pro` vanilla rejections**: opencode at `transform.ts:518,571-588` special-cases certain GPT-5 model IDs and release dates: `gpt-5-pro` only accepts `["high"]`; `gpt-5-chat` only accepts `["medium"]`; release-date gating: post `2025-11-13` enables `none`, post `2025-12-04` enables `xhigh`; `gpt-5.2+` codeset adds `xhigh`; `gpt-5-codex-3-plus` enables `none`. If we support OpenAI Responses via this OpenAI-compat adapter for these tiers, replicate the date-gated capability table — sending an unsupported effort tier returns API rejection (some errors will be cryptic and look like general "bad model" errors).
- **OpenRouter uses a different blob key**: `body.reasoning.effort` (nested), not `body.reasoning_effort` flat. Out of scope but worth knowing if anyone later adds OpenRouter transport.
- **OpenAI Responses stores reasoning server-side until `store: false`**: when `store: false` you must inline the full reasoning item including `encrypted_content` AND filter out reasoning items lacking `encrypted_content` (OpenAI hard-rejects the latter — see `openai-responses.ts:344-452`). If OpenAI Responses support ever lands in Claude Code (Plan optional Q5), this is a sharp edge.
- **`stop_reason: "max OUTPUT tokens"` and similar** in Anthropic's streaming response differs from the streaming delta names; the parser at opencode's `anthropic-messages.ts` uses `stepStart` to delimit multi-turn-with-tool-call reasoning and `finish` to flush any in-flight reasoning block. The current Claude Code already handles this for anthropic — the rewrite MUST preserve the lifecycle ordering, not lose it.
- **DeepSeek requires all assistant messages to have reasoning on them** (opencode `transform.ts:269-284` re-injects `{ type: "reasoning", text: "" }` on any assistant content missing one). If the OpenAI-compat path eventually allows DeepSeek models through, copy that helper.
- **Generic openai-compat reasoning round-trip** (transform.ts:286-318): for providers whose `model.capabilities.interleaved.field` is `"reasoning_content"` or `"reasoning_details"`, outgoing assistant turns must hoist `ReasoningPart[]` text back into a single assistant-message-level field on `providerOptions.openaiCompatible[<field>]`. This is needed for DeepSeek, Qwen, and similar — not for vanilla OpenAI Chat, where reasoning is per-message-level `reasoning_content` natively.
- **Anthropic's `thinkingClearLatched`** flag (see `src/services/api/claude.ts:1636`, `getAPIContextManagement`) hooks into the `REDACT_THINKING_BETA_HEADER`. Per-turn clearing of thinking is independent of the variant — keep it through the migration.
- **`temperature` suppression when thinking is on** is API-required (see `claude.ts:1693-1695`, comment at `:1692`): Anthropic's API forces `temperature: 1` whenever thinking is enabled, so Claude Code omits the field. Keep this behavior — carried over by the lower-thinking function.
- **`anthropicAdaptiveEfforts()` returns different tier lists per model family** at `transform.ts:608-620`: Opus 4.7+ and Fable-5 get `["low","medium","high","xhigh","max"]`; Opus 4.6 / Sonnet 4.6 get `["low","medium","high","max"]`. Replicate this, do NOT flatten to a single tier list across all adaptive-capable models.
- **opencode's SDK public alias differs from CLI-internal type** at `/home/git/opencode/packages/llm/src/runtimeTypes.ts:1` — exports `EffortLevel = 'low' | 'medium' | 'high' | 'auto'` while the CLI uses `'max'` instead of `'auto'`. We should NOT replicate this inconsistency on our side; settle on one enum and use it everywhere.
- **`reason` not to repeat opencode's mistake**: opencode's `lowerThinking()` in `anthropic-messages.ts:489-502` only handles the legacy `type: "enabled"` shape. The adaptive + bare-effort shapes are split elsewhere — opencode's protocol parser doesn't fully lower them in the native runtime path (relies on the AI SDK path). Porting that means **extending** the lower to also handle `{ type: "adaptive", display?, effort }` (Adaptive) and `{ effort }` (Opus 4.5). Do not copy opencode's incomplete lower — finish it.

## Next steps

Recommended single concrete next action (assuming you take the recommended defaults from the Plan section in the chat above, namely Q1(a) Anthropic-native only, Q2(a) full adaptive-tier matrix, Q3(a) hardcode in `model/configs.ts`):

1. **Create the variant type and the per-model variant table.** Write `src/utils/effort/variantTypes.ts` exporting `VariantID` (the `none|minimal|low|medium|high|xhigh|max` union) and `VariantBlob` (`Record<string, unknown>`). Then either:
   - (Q3(a) — recommended) Add a `variants?: Partial<Record<VariantID, VariantBlob>>` field to entries in `src/utils/model/configs.ts:31-83`, and a `getModelVariants(model, provider): Record<VariantID, VariantBlob>` accessor that returns the model's variants (or `{}` if the model has none — e.g. claude-3-*).
   - (Q3(b) — alternative) Write `src/utils/effort/modelVariants.ts` with `getModelVariants(model, provider)` that computes the blob table by inspecting canonical name + provider (mirror opencode's `case "@ai-sdk/anthropic"` switch at `transform.ts:894-938`).
2. **Build `lowerThinking()`** — new `src/services/api/effort/lowerThinking.ts`. Signature: `lowerThinking({ model, maxOutputTokens }, target, variantBlob): { thinking?, outputConfig?, extraBodyParams?, betas? }`. Target union `'anthropic_native' | 'openai_chat' | 'openai_responses' | 'openai_compatible'` (last three collapse to one for the first cut). The Anthropic-native case writes the three blob shapes above. The openai_chat case writes `body.reasoning_effort = blob.reasoningEffort` and pushes no beta.
3. **Replace the block at `claude.ts:1596-1630` and `claude.ts:40-66`** with a single call to `lowerThinking()` after resolving `target` from `getAPIProvider()` + openai-compat env. Result becomes the `thinking` and `output_config` fields at `claude.ts:1699-1728`.
4. **Patch `openaiCompatible.ts:toOpenAIRequest()` at `:340-357`** to read `reasoning_effort` from the params it's now passed (because `lowerThinking` populated an `extraBodyParams` that already includes `reasoning_effort` — verify the call site in `claude.ts` forwards those extras to the OpenAI-compat adapter rather than dropping them on the floor).
5. **Add the response-side `ReasoningPart`** + lifecycle helper. New file `src/services/api/reasoningLifecycle.ts` (port of opencode's `lifecycle.ts:6-99` verbatim — pure logic, no deps). Refactor the existing Anthropic-stream thinking-block parser to funnel through these primitives (the existing stream code already handles `thinking_delta` / `signature_delta` / `content_block_start thinking` — just rename "thinking"→"reasoning" in the abstraction and route through the lifecycle so the UI calls all three event types the same way regardless of provider).
6. **Extend the OpenAI-compatible response stream parser** (same file, `:429-521` region) to emit `reasoningDelta` events when `delta.reasoning_content` arrives. The chunk types at `:81,101` already read those fields — only the event-emission side is missing.
7. **Update UI surfaces** (`/effort` slash command, `EffortCallout`, `EffortIndicator`, `ModelPicker`, `ThinkingToggle`, `Spinner`, `LogoV2`) to render available variants from `getModelVariants(model, getAPIProvider())` rather than the hardcoded `EFFORT_LEVELS` array. When variants are empty (e.g. claude-3-* or any model with no thinking support), hide the picker.

Recommended order: steps 1 + 2 in one PR (no behavior change yet, just new modules). Step 3 + 4 + 5 + 6 in a second PR (this is the behavior flip — openai-compat now sends `reasoning_effort`). Step 7 in a third PR (UI polish). Delete `src/utils/thinking.ts` and slim `src/utils/effort.ts` in a fourth PR after one release of dual-path compat.

Alternative ordering: if you want the OpenAI-compat fix ASAP (smallest possible PR), write steps 1+2+4 only (the OpenAI-compat `reasoning_effort` side) and skip steps 3+5+6 (Anthropic path can stay as-is for now; the variant table is the bridge that lets both paths share the same source-of-truth). Less work, smaller blast radius — but doesn't fully "get rid of the old anthropic thinking shit," only fixes the openai-compat omission.

## How to verify current state

Run these BEFORE trusting anything above:

```bash
cd /home/projects/cc

# 1. Confirm working tree is unchanged (no stray edits from this session)
git status
# expected: "On branch test / nothing to commit, working tree clean"

# 2. Confirm the thinking-effort code is still the old Anthropic-native shape
#    (if these line numbers shifted, the analysis section is stale)
sed -n '1590,1635p' src/services/api/claude.ts
# expected: see the `hasThinking` block at :1596-1630 building
#           `thinking = { type: 'adaptive' }` or `{ budget_tokens, type: 'enabled' }`

# 3. Confirm no `reasoning_effort` writing exists yet anywhere in the tree
rg -n "reasoning_effort|reasoningEffort" .
# expected: zero hits on src/*, optional hits on node_modules/@anthropic-ai/sdk

# 4. Confirm the OpenAI-compat adapter still drops thinking today
sed -n '340,360p' src/services/api/openaiCompatible.ts
# expected: toOpenAIRequest returns only model/messages/tools/tool_choice/
#           max_tokens/temperature/top_p/stop_sequences — NO reasoning_effort

# 5. Confirm ThinkingConfig still exists and is widely consumed
rg -l "ThinkingConfig|thinkingConfig" src/ | wc -l
# expected: ~25-30 source files — these are the migration surface

# 6. Confirm beta header constants are where this doc claims
sed -n '4,21p' src/constants/betas.ts
# expected: INTERLEAVED_THINKING/EFFORT/REDACT_THINKING/TASK_BUDGETS constants

# 7. Confirm opencode source is still at the path we port from
ls /home/git/opencode/packages/opencode/src/provider/transform.ts \
   /home/git/opencode/packages/llm/src/protocols/{anthropic-messages,openai-chat,utils/lifecycle}.ts
# expected: all four paths exist

# 8. Confirm this handoff is the latest file in the repo (sanity check)
ls -la handoff.md
# expected: timestamp = today's session; size > 30KB
```

If any of (1)-(7) drifts (e.g. someone shipped a partial implementation between this doc being written and you reading it), trust the filesystem over this doc: re-investigate that area, update the doc, then proceed.

**First action for the next agent** (assuming you accept the plan defaults): start at "Next steps" step 1 above. Create `src/utils/effort/variantTypes.ts` and decide Q3(a vs b) before writing `modelVariants.ts` or extending `model/configs.ts`. Do not start with steps 3-7 until steps 1-2 exist as standalone modules.
