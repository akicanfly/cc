# Handoff: Enable `USER_TYPE=ant` Mode

## Goal

Make the program consistently recognize `USER_TYPE=ant` at runtime so that all ant-internal features (undercover mode, `/insights`, `/ultraplan`, `/thinkback`, Tungsten, enhanced telemetry, internal debugging tools, etc.) activate cleanly without hanging or crashing.

The source currently has an **inconsistency**: 335 `process.env.USER_TYPE === 'ant'` runtime checks in `.ts` files coexist with 88 hardcoded `"external" === 'ant'` (always-false) literals in `.tsx` files. This half-activated state causes boot hangs.

## Current state

Verified via grep across `src/`:

- **335 occurrences** of `process.env.USER_TYPE` in **162 `.ts` files** — runtime check, works when `USER_TYPE=ant` is set in the environment
- **88 occurrences** of `"external" === 'ant'` in **27 `.tsx` files** — compile-time constant, always `false`, blocks ant mode
- **2 occurrences** of `"production" === 'development'` in 2 files — same pre-compiled pattern
- **12 of 22 stub packages** throw `"not included in this build"` errors, but none are hit during normal ant-mode operation (they're only triggered by specific opt-in env vars like `CLAUDE_CODE_USE_BEDROCK`)
- Build system uses `scripts/macros.ts` for `MACRO.*` defines; `USER_TYPE` is NOT in `macros.ts` — it was passed as a `--define` flag in CI/CD, but the current `build.ts` doesn't include it
- `src/utils/protectedNamespace.ts` is a no-op stub (always returns `false`) — safe
- All ant-only network calls have bounded timeouts (5s GrowthBook, 30s remote settings)
- All ant-only subprocess calls are fire-and-forget or memoized

The program **hangs** today because `"external" === 'ant'` is always `false` in `.tsx` files while `process.env.USER_TYPE === 'ant'` returns `true` in `.ts` files, creating a broken half-initialized state.

## Files involved

### Must edit (28 files, ~90 replacements)

**High priority** (ant UI features, boot paths):
- `src/main.tsx` — 18 occurrences, boot logic, feature registration
- `src/screens/REPL.tsx` — 22 occurrences, main REPL screen (frustration detection, model switch, undercover callouts, DevBar, Tungsten monitor, skill feedback survey)
- `src/components/PromptInput/PromptInput.tsx` — 7 occurrences, Tungsten session, coordinator tasks, background task pills
- `src/tools/AgentTool/AgentTool.tsx` — 5 occurrences, remote isolation mode, auto-classifier permission mode
- `src/components/PromptInput/PromptInputFooterLeftSide.tsx` — 4 occurrences, Tungsten pill, coordinator tasks
- `src/utils/processUserInput/processSlashCommand.tsx` — 3 occurrences, ant-only slash commands
- `src/components/LogoV2/feedConfigs.tsx` — 3 occurrences, internal changelog feed
- `src/components/Stats.tsx` — 2 occurrences, speculation stats display
- `src/components/PromptInput/PromptInputFooter.tsx` — 2 occurrences, undercover indicator, coordinator panel
- `src/tools/AgentTool/UI.tsx` — 2 occurrences, agent message response UI
- `src/buddy/useBuddyNotification.tsx` — 2 occurrences, buddy notifications
- `src/commands/thinkback/thinkback.tsx` — 2 occurrences, marketplace name/repo selection
- `src/commands/ultraplan.tsx` — 2 occurrences, ultraplan prompt file and enabled check
- `src/commands/mcp/mcp.tsx` — 1 occurrence
- `src/commands/terminalSetup/terminalSetup.tsx` — 1 occurrence
- `src/components/DevBar.tsx` — 1 occurrence (also has `"production" === 'development'`)
- `src/components/Feedback.tsx` — 1 occurrence, GitHub issues URL
- `src/components/MessageSelector.tsx` — 1 occurrence
- `src/components/NativeAutoUpdater.tsx` — 1 occurrence
- `src/components/Settings/Config.tsx` — 1 occurrence, ant-only settings
- `src/components/Spinner.tsx` — 1 occurrence, API metrics display
- `src/components/agents/ToolSelector.tsx` — 1 occurrence, Tungsten tool
- `src/components/messages/AttachmentMessage.tsx` — 1 occurrence, skill feedback hint
- `src/components/permissions/BashPermissionRequest/bashToolUseOptions.tsx` — 1 occurrence
- `src/components/tasks/taskStatusUtils.tsx` — 1 occurrence
- `src/tools/TaskStopTool/UI.tsx` — 1 occurrence
- `src/utils/autoRunIssue.tsx` — 1 occurrence
- `src/ink/ink.tsx` — 1 occurrence of `"production" === 'development'`

### Build config (optionally edit)
- `scripts/macros.ts` — add `process.env.USER_TYPE: '"ant"'` to defines
- `scripts/build.ts` — no change needed if macros.ts updated

### Safe (no changes needed)
- All `.ts` files using `process.env.USER_TYPE` — already runtime, work as-is
- `src/utils/protectedNamespace.ts` — no-op, always returns false
- All stubs in `stubs/` — not hit during normal ant operation
- `original/source/src/` — reference copy, not used at runtime

## What's changed this session

Nothing yet — this is a planning session only. The handoff is for executing the plan.

## Constraints and things to avoid

- **Do NOT edit `.ts` files** searching for `process.env.USER_TYPE` — those are already correct runtime checks. Only the `.tsx` files with `"external" === 'ant'` need changes.
- **Do NOT change the `feature()` calls** from `bun:bundle` — those are a separate DCE mechanism and are properly handled by the bundler.
- **Do NOT modify `original/`** — it's a pristine reference copy of the upstream source.
- **Do NOT delete or modify stub packages** — they're needed for the external build. Ant mode only triggers them if you also opt into Bedrock/Vertex/Foundry.
- **Do NOT add new dependencies** — the stubs in `stubs/` are intentionally minimal for bundle size.

## What's been tried and failed

Nothing — this is a new task.

## Other learnings

- The `"external"` string in `"external" === 'ant'` was put there by a bulk text replacement of `process.env.USER_TYPE` → `"external"` across all `.tsx` files (but not `.ts` files). Reversing it is a simple find-and-replace.
- 22 stub packages exist at `stubs/`, 12 of which throw errors. They replace real AWS/Azure/OTel/Google dependencies to keep the external bundle small. Ant mode only reaches them if explicit provider env vars (`CLAUDE_CODE_USE_BEDROCK`, etc.) are also set.
- The `scripts/dev.ts` already passes all `MACRO.*` defines from `scripts/macros.ts` via `--define` flags. Adding `USER_TYPE` to `macros.ts` means both dev and build modes would automatically include it.
- `git log --oneline` shows 5 commits on this branch. The most recent (`89c7734`) modifies `scripts/install.ts`.

## Next steps

Execute the plan:

1. **Replace all `"external" === 'ant'` → `process.env.USER_TYPE === 'ant'`** in all 27 `.tsx` files listed above. Use `edit` with `replaceAll: true` per file — every match is an exact string.
2. **Fix `"production" === 'development'` → `process.env.NODE_ENV === 'development'`** in `src/components/DevBar.tsx` and `src/ink/ink.tsx`.
3. **Add `USER_TYPE` to build defines** in `scripts/macros.ts`:
   ```
   'process.env.USER_TYPE': '"ant"',
   ```
4. **Build and test**:
   ```bash
   # Dev run:
   bun run scripts/dev.ts

   # Build binary:
   bun run build

   # With compile:
   bun run build:compile
   ```
5. **Verify** by running the built binary and checking that ant-specific features (`/insights`, undercover mode, etc.) are accessible without hangs.

## How to verify current state

```bash
# Confirm the inconsistent state:
grep -rn '"external" === .ant' src/ --include='*.tsx' | wc -l    # should be 88
grep -rn 'process.env.USER_TYPE' src/ --include='*.ts' | wc -l   # should be 335

# After fixes:
grep -rn '"external" === .ant' src/ --include='*.tsx' | wc -l    # should be 0
grep -rn '"production" === .development' src/ --include='*.{ts,tsx}' | wc -l  # should be 0

# Quick smoke test (no build needed):
USER_TYPE=ant bun run scripts/dev.ts -- --version
```
