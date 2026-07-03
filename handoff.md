# Handoff: Model Picker Fetch and Filter

## Goal
Make the `/model` command fetch available models from the provider (Anthropic, OpenAI-compatible, etc.) instead of showing hardcoded Claude model names, and add type-to-filter UI. The picker should work consistently for all providers and avoid visual layout issues.

## Current state
- Fetch helper in `src/utils/model/fetchedModelOptions.ts` branches on provider:
  - OpenAI-compatible: GETs `{baseURL}/models`
  - Anthropic/Bedrock/Vertex/Foundry: uses `anthropic.models.list()`
- Standalone ModelPicker (`/model`) uses fetched models instead of hardcoded options
- Type-to-filter added – works even in empty-match state (Esc exits, backspace clears filter)
- `j`/`k` keys now go to filter instead of being consumed by the Select's vim-style navigation
- Digits 1-9 filter instead of selecting options in fetched mode
- Layout gap issue resolved (drop description → bypasses TwoColumnRow alignment padding)
- Build passes (`bun run build`)

## Root cause of the layout gap (resolved)
The `Select` component's default `compact` layout has two sub-paths:
- **Two-column row** when any visible option has a `description` – computes `maxLabelWidth` and pads rows to align descriptions into a column
- **Simple SelectOption** list otherwise

Model IDs vary widely in width, so alignment padding produced big, shifting gaps. Setting fetched options' `description` to `''` (falsy) makes `hasDescriptions` false, forcing the simple one-line-per-option path.

## Root cause of j/k conflict (resolved)
The Select component registers `select:next`/`select:previous` keybindings that match `j`/`k` (vim-style nav). Because the Select is a child of ModelPicker, its `useInput` listener registers before the parent's, so the Select handles `j`/`k` and calls `stopImmediatePropagation()` before the picker's filter ever sees the keystroke.

**Fix**: Added `FilterKeyInterceptor` – a child component placed BEFORE `<Select>` in JSX declaration order. Child effects fire before parent effects, so this interceptor's `useInput` registers first, captures printable chars via `stopImmediatePropagation()`, and routes them to `setFilterText` before the Select sees them. Navigation keys (arrows, Enter, Tab) pass through unchanged.

## Empty-match Esc/backspace fix
`FilterKeyInterceptor` is placed at the top-level `content` wrapper, NOT inside the `filteredOptions.length > 0` conditional. When filtering yields no matches, the `<Select>` unmounts but the interceptor stays – it swallows Esc to call `onCancel` directly and handles backspace/delete to restore previous filter chars.

## Files involved
- `src/utils/model/fetchedModelOptions.ts` – fetch helper; description now `''`
- `src/components/ModelPicker.tsx` – picker UI; `FilterKeyInterceptor` child, fetched-mode description neutralization
- `src/services/api/openaiCompatible.ts` – `listOpenAICompatibleModels()`
- `src/components/CustomSelect/select.tsx` – underlying Select; not modified (behavior used as designed)
- `src/components/CustomSelect/use-select-input.ts` – Select input handler; not modified

## What's changed this session
- Runtime model fetching with provider branching
- Replaced hardcoded Claude marketing options with fetched model IDs
- Type-to-filter with `highlightText` support (`j`/`k` now filter, Esc exits in empty state)
- Digits filter instead of select in fetched mode
- Neutralized standalone picker text
- Fetched option descriptions set to `''` (fixes column-alignment gaps) – `fetchedModelOptions.ts:43`
- "Current model" row description neutralized in fetched mode – `ModelPicker.tsx:127`
- `FilterKeyInterceptor` child component (captures printable chars/stops propagation) placed at `content` top-level so it stays mounted regardless of empty/non-empty filter – `ModelPicker.tsx`

## Constraints and things to avoid
- Don't break non-standalone ModelPicker usage (agent setup, etc.) – `useFetchedModels` gated on `isStandaloneCommand === true`
- Keep inline `/model model-name` validation behavior
- Preserve fast-mode and effort handling
- Don't add new network requests for non-standalone usage
- Interceptor's Esc swallowing only replaces `select:cancel` – same `onCancel` prop; no behavioural change for user

## What's been tried and failed
- Initial version only fetched Anthropic models, missed OpenAI-compatible support
- First build failed due to type issues, fixed by adjusting imports/exports
- Investigated `highlightText` fragment labels desyncing `stringWidth` via ANSI – verified not the case; `getTextContent` returns plain text
- First interceptor placed inside `filteredOptions.length > 0` conditional → empty-match unmounted both `<Select>` and interceptor → backspace/Esc dead. Fixed by moving interceptor to top-level `content`.
- Interceptor initially didn't handle Esc → when `<Select>` unmounted (empty list), no `select:cancel` binding to exit. Fixed by swallowing Esc in interceptor and calling `onCancel` directly.

## Other learnings
- OpenAI-compatible providers need `{baseURL}/models` endpoint support
- `stopImmediatePropagation()` + child-first effect registration = reliable preemption of downstream listeners
- Empty-string `description` is falsy and reliably bypasses description render paths (verified at `select.tsx:403,450,465`)

## Next steps
Feature is complete. Optional follow-ups:
- Verify visually against an OpenAI-compatible endpoint with mixed-width model IDs
- Consider widening `ModelOption.description` to `string | undefined`
- Populate fetched options with richer descriptions from provider API responses (pricing/owner metadata)

## How to verify current state
1. `bun run build` – passes
2. `/model` – types filter, `j`/`k` add to filter (not nav), Esc exits, backspace deletes
3. Filter to empty match – Esc exits (via interceptor), backspace restores chars
4. Set `OPENAI_COMPATIBLE_BASE_URL` + `OPENAI_COMPATIBLE_API_KEY` and run `/model` – fetches from `/models` endpoint
5. `/model` with Anthropic – fetches via `anthropic.models.list()`