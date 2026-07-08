# USER_TYPE=ant — Complete Reference

> Everything that is exclusive to Anthropic employees (`USER_TYPE=ant`) in Claude Code.
> In external builds `process.env.USER_TYPE` is replaced with the string literal `"external"` at compile time. Every `=== 'ant'` branch is dead-code-eliminated. **Zero runtime overhead.**

---

## Table of Contents

1. [Extra Tools](#1-extra-tools)
2. [Slash Commands](#2-slash-commands)
3. [CLI Flags](#3-cli-flags)
4. [Debugging & Logging](#4-debugging--logging)
5. [Undercover Mode](#5-undercover-mode)
6. [Models & Context](#6-models--context)
7. [Beta Headers & Experiments](#7-beta-headers--experiments)
8. [Bridge / Remote Control](#8-bridge--remote-control)
9. [Bash & Permissions](#9-bash--permissions)
10. [OAuth & Authentication](#10-oauth--authentication)
11. [IDE Integration](#11-ide-integration)
12. [Telemetry & Analytics](#12-telemetry--analytics)
13. [Setup & Config](#13-setup--config)
14. [Auto-Updater & Releases](#14-auto-updater--releases)
15. [System Prompt Differences](#15-system-prompt-differences)
16. [UI Differences](#16-ui-differences)
17. [Tips Differences](#17-tips-differences)
18. [Infrastructure & Internal Tooling](#18-infrastructure--internal-tooling)
19. [Miscellaneous Always-On Features](#19-miscellaneous-always-on-features)
20. [Planned / Commented-Out Gates](#20-planned--commented-out-gates)

---

## 1. Extra Tools

| Tool | File | Description |
|------|------|-------------|
| **ConfigTool** | `src/tools.ts:214` | Read/write config values at runtime via tool calls |
| **TungstenTool** | `src/tools.ts:215` | tmux-based multiplexed panel management |
| **REPLTool** | `src/tools.ts:16-19,232` | Interactive code REPL mode (also default-on in CLI, see §13) |
| **SuggestBackgroundPRTool** | `src/tools.ts:20-24` | Creates background PRs from work done by sub-agents |
| **AgentTool in sub-agents** | `src/constants/tools.ts:41` | Ant users can use AgentTool (nested agents); the tool name is **removed** from the external tool list, preventing sub-agents |

## 2. Slash Commands

### Internal-only command group (`INTERNAL_ONLY_COMMANDS`, `src/commands.ts:225-254,343-345`)

Registered when `USER_TYPE === 'ant' && !process.env.IS_DEMO`:

| Command | Description |
|---------|-------------|
| `/backfillSessions` | Backfill session data |
| `/breakCache` | Break prompt cache |
| `/bughunter` | Bug hunting tool |
| `/commit` | Generate commit messages |
| `/commitPushPr` | Generate commit + push + PR workflow |
| `/ctx_viz` | Context window visualization |
| `/goodClaude` | Good Claude feedback |
| `/issue` | File model-quality issues |
| `/initVerifiers` | Initialize verifiers |
| `/forceSnip` | Force context snipping |
| `/mockLimits` | Mock rate limits for testing |
| `/bridgeKick` | Bridge fault injection |
| `/version` | Print exact version |
| `/ultraplan` | Ultra-plan mode |
| `/subscribePr` | Subscribe to PR events |
| `/resetLimits` | Reset rate limits |
| `/resetLimitsNonInteractive` | Reset rate limits (non-interactive) |
| `/onboarding` | Onboarding flow |
| `/share` | Share session transcripts |
| `/summary` | Summarize session |
| `/teleport` | Teleport to another context |
| `/antTrace` | Ant-specific tracing |
| `/perfIssue` | Performance issue reporter |
| `/env` | Environment inspection |
| `/oauthRefresh` | Refresh OAuth tokens |
| `/debugToolCall` | Debug tool calls |
| `/agentsPlatform` | Agent platforms management |
| `/autofixPr` | Auto-fix PRs |

### Other ant-only command registrations

| Command | File | Notes |
|---------|------|-------|
| `/agents-platform` | `src/commands.ts:48-51` | Conditionally loaded via `require()` |
| `/version` | `src/commands/version.ts:17` | `isEnabled: () => process.env.USER_TYPE === 'ant'` |
| `/ultraplan` | `src/commands/ultraplan.tsx:466` | Entire command is ant-only |
| `/tag` | `src/commands/tag/index.ts:7` | `isEnabled: () => process.env.USER_TYPE === 'ant'` |
| `/files` | `src/commands/files/index.ts:7` | File management command |
| `/bridge-kick` | `src/commands/bridge-kick.ts:57,195` | Bridge debug command |
| `/cost` | `src/commands/cost/index.ts:14` | Cost tracking |
| `/thinkback` | `src/commands/thinkback/thinkback.tsx:32,35` | Internal marketplace name/repo URL |
| `/thinkback-play` | `src/commands/thinkback-play/thinkback-play.ts:12` | Thinkback playback |

### CLI top-level subcommands (`src/main.tsx:4370-4459`)

| Command | Description |
|---------|-------------|
| `claude up` | Run CLAUDE.md `# claude up` setup instructions |
| `claude rollback` | Rollback to previous versions |
| `claude log` | Manage conversation logs |
| `claude task` | Manage task lists (create, list, etc.) |
| `claude mcp` (internal tools) | Extra internal marketplace reference in `/mcp` |

## 3. CLI Flags

All registered in `src/main.tsx:3816-3828`:

| Flag | Description |
|------|-------------|
| `--delegate-permissions` | Alias for `--permission-mode auto` |
| `--dangerously-skip-permissions-with-classifiers` | Deprecated alias for `--permission-mode auto` (hidden) |
| `--afk` | Deprecated alias for `--permission-mode auto` (hidden) |
| `--tasks [id]` | Tasks/watch mode — auto-process tasks, optional id (hidden) |
| `--agent-teams` | Force multi-agent mode |
| `--homespaces` | (`src/commands/insights.ts:2808`) Collect session data from remote Coder workspaces |
| `--worktree [name]` | Create git worktree for session |
| `--tmux` | Create tmux session for worktree |

### Conditional parse gates in `src/main.tsx`

| Flag / Feature | Line | Effect |
|----------------|------|--------|
| `--tasks [id]` and taskListId | 1137-1143 | Parsed only for ants |
| `CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER` | 2223 | Ants can install asciicast recorder for terminal recording |

## 4. Debugging & Logging

### Always-on debug logging

| Feature | File | Detail |
|---------|------|--------|
| Bridge session debug files | `src/bridge/bridgeMain.ts:1135` | Debug files written **even without `--verbose`** |
| Bridge debug log path in UI | `src/bridge/bridgeUI.ts:224` | `[ANT-ONLY] Logs:` yellow line shown |
| Session runner debug files | `src/bridge/sessionRunner.ts:264` | Always written to tmpdir |
| API request messages cached | `src/utils/log.ts:351` | Final messages retained in memory for `/share` |
| All debug logs to disk | `src/utils/debug.ts:111` | `shouldWriteLogMessage()` always returns true |
| Structured error log file | `src/utils/errorLogSink.ts:112` | Writes JSON error logs to `~/.claude/errors/` |
| `logAntError()` | `src/utils/debug.ts:259` | Dedicated ant-only error logging function |
| Slow operation threshold | `src/utils/slowOperations.ts:40` | 300ms (vs Infinity for external) — enables warnings |
| Slow operation tracking | `src/bootstrap/state.ts:1570` | Tracks slow operations for DevBar |

### Enhanced error messages

| Feature | File | Detail |
|---------|------|--------|
| 400 error detail | `src/services/api/errors.ts:687` | Shows `/share` and internal channel instructions |
| Invalid model name error | `src/services/api/errors.ts:754` | Includes org UUID for requesting access |
| Rate limit messages | `src/services/rateLimitMessages.ts:339` | Includes feedback channel and `/reset-limits` suggestion |
| JSON parse failures | `src/utils/messages.ts:2687` | Debug logs first 200 chars of raw input |
| Node warning detail | `src/utils/warningHandler.ts:102` | Full warning message logged (external: classname only) |
| WebFetchTool domain logging | `src/tools/WebFetchTool/utils.ts:400` | `tengu_web_fetch_host` events per fetched hostname |
| Thinking output capture | `src/services/api/logging.ts:746` | Thinking blocks from API responses captured for telemetry |
| 5xx retry bypass | `src/services/api/withRetry.ts:748` | Ants ignore `x-should-retry: false` on 5xx errors |

### API metrics tracking (`src/screens/REPL.tsx`)

| Feature | Line | Detail |
|---------|------|--------|
| TTFT measurement | 2485 | Time-to-first-token tracked per query |
| API metrics flush | 2814 | Metrics flushed at end of each query |

## 5. Undercover Mode

**Entirely ant-only.** (`src/utils/undercover.ts`)

| Function | Detail |
|----------|--------|
| `isUndercover()` | Auto-detects public repos via repo classification. Active unless repo remote is allowlisted. Force-on via `CLAUDE_CODE_UNDERCOVER=1`. No force-off — safe default is ON. |
| `getUndercoverInstructions()` | Returns detailed prompt instructions: no internal codenames, no model names, no AI mentions, no attribution, write as a human developer. |
| `shouldShowUndercoverAutoNotice()` | One-time explainer dialog shown when undercover auto-detected (not forced). |

### Undercover impacts

| Area | File | Effect |
|------|------|--------|
| Commit messages | `src/commands/commit.ts:16` | Undercover instructions prepended to commit prompt |
| PR workflow | `src/commands/commit-push-pr.ts:49` | Strips reviewer args, changelog sections, Slack posting |
| Attribution | `src/utils/attribution.ts:53,300` | Empty attribution (no co-author), skip PR attribution |

## 6. Models & Context

### Internal model registry

| File | Lines | Effect |
|------|-------|--------|
| `src/utils/model/antModels.ts` | 35,45,54 | Whole file is ant-only — internal model definitions with codenames |
| `src/utils/model/model.ts` | 180,400,485,558 | Internal model resolution, extra aliases (codenames), details, overrides |
| `src/utils/model/modelOptions.ts` | 46,272 | Ant-only model option defaults, extended resolution |
| `src/utils/model/modelCapabilities.ts` | 47 | Certain capabilities only available to ant models |
| `src/utils/model/providers.ts` | 33 | Ant model provider configuration |
| `src/utils/context.ts` | 60,91,156 | Context window override via `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, ant-specific context/output token sizes |
| `src/utils/effort.ts` | 72,220,261,299 | Max effort on ant models, numeric effort values (0-100), effort persistence |
| `src/utils/thinking.ts` | 95 | Thinking support for ant models, thinking signature block processing |

### API client model features (`src/services/api/claude.ts`)

| Line | Feature |
|------|---------|
| 407 | **1-hour prompt cache** — ants always eligible regardless of subscription/overage |
| 438 | **Numeric effort override** — sends `anthropic_internal.effort_override` to API |
| 1993, 2172, 2211, 2226, 2590, 2687 | **Research field capture** — captures `research` fields from streaming API (message_start, content_block_delta, message_delta) and attaches to assistant messages |

### Query fallback (`src/query.ts:927`)

Ants strip thinking signature blocks before model fallback retry to avoid 400 errors.

### Model override suffix (`src/constants/prompts.ts:136-140`)

Ants get an optional model override in the system prompt (unless undercover). External users never get this.

## 7. Beta Headers & Experiments

| Header / Feature | File | Detail |
|------------------|------|--------|
| `cli-internal-2026-02-09` | `src/constants/betas.ts:30` | Sent with every API request (external: empty string) |
| CLI_INTERNAL_BETA_HEADER | `src/utils/betas.ts:243,411` | Used for agentic queries too |
| Token-efficient tools beta | `src/utils/betas.ts:338` | FC v3 JSON tool format |
| API context management | `src/utils/betas.ts:303` | Tool clearing experiment |
| Connector text summarization | `src/utils/betas.ts:291` | API-side summarization beta |
| `TRANSCRIPT_CLASSIFIER` | `src/utils/permissions/yoloClassifier.ts:66` | Classifier permission dependency |

### Experiments always-on for ants

| Feature | File | External users need |
|---------|------|-------------------|
| Enhanced telemetry | `src/utils/telemetry/sessionTracing.ts:138` | Feature gate `enhanced_telemetry_beta` |
| Immediate commands (`/model`, `/fast`, `/effort`) | `src/utils/immediateCommand.ts:12` | Experiment `tengu_immediate_model_command` |
| Deferred tools delta | `src/utils/toolSearch.ts:631` | Feature gate `tengu_glacier_2xr` |
| MCP instructions delta | `src/utils/mcpInstructionsDelta.ts:41` | Feature gate `tengu_basalt_3kr` |
| Plan mode interview phase | `src/utils/planModeV2.ts:52` | Feature gate |
| Computer use | `src/utils/computerUse/gates.ts:40` | Feature gate |
| Agent swarms | `src/utils/agentSwarmsEnabled.ts:26` | Feature gate |
| Advisor tool | `src/utils/advisor.ts:94,104` | Feature gate |

### Mock rate limits (entirely ant-only, `src/services/mockRateLimits.ts`)

All functions (104, 253, 281, 322, 603, 619, 714, 809, 817, 829, 835) early-return for non-ant. Includes:
- `setMockHeader`, `addExceededLimit`, `setMockRateLimitScenario`
- `getMockHeaderless429Message`, `getMockHeaders`
- `shouldUseMockSubscription`, `setMockBillingAccess`

## 8. Bridge / Remote Control

### Fault injection & debugging

| Feature | File | Detail |
|---------|------|--------|
| Fault injection wrapper | `src/bridge/replBridge.ts:330` | API client wrapped for injecting failures |
| SIGUSR2 handler | `src/bridge/replBridge.ts:972` | Forces bridge reconnection (Unix only) |
| `/bridge-kick` commands | `src/bridge/replBridge.ts:987` | Fault injection via `registerBridgeDebugHandle` |
| Bridge debug cleanup | `src/bridge/replBridge.ts:1575` | Teardown: `clearBridgeDebugHandle` |

### URL & token overrides

| Environment Variable | File | Override |
|---------------------|------|----------|
| `CLAUDE_BRIDGE_OAUTH_TOKEN` | `src/bridge/bridgeConfig.ts:20` | Bridge OAuth token |
| `CLAUDE_BRIDGE_BASE_URL` | `src/bridge/bridgeConfig.ts:29` | Bridge server base URL |
| `CLAUDE_BRIDGE_SESSION_INGRESS_URL` | `src/bridge/bridgeMain.ts:2201,2854`, `src/bridge/initReplBridge.ts:468` | Session ingress URL for WebSocket |

### REPL bridge state

| Feature | File | Detail |
|---------|------|--------|
| `replBridgeActive` field | `src/bootstrap/state.ts:391` | Extra state field in bootstrap (external builds omit entirely) |

## 9. Bash & Permissions

### Bash sandbox bypass

| Feature | File | Detail |
|---------|------|--------|
| Dynamic sandbox disabled commands | `src/tools/BashTool/shouldUseSandbox.ts:23` | GrowthBook-configured blocked commands/substrings |

### Ant-only safe env vars (`src/tools/BashTool/bashPermissions.ts`)

Used in permission prefix rules without triggering fallback to exact-match mode:

`KUBECONFIG`, `DOCKER_HOST`, `AWS_PROFILE`, `AWS_DEFAULT_REGION`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AZURE_CONFIG_DIR`, `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_CONFIG`, `TF_VAR_*`, `PGPASSWORD`, `PGUSER`, `PGHOST`, `PGPORT`, `PGDATABASE`, `MYSQL_PWD`, `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_DATABASE`, `SSH_AUTH_SOCK`, `SSH_AGENT_PID`, `GIT_SSH_COMMAND`, `GIT_SSH_VARIANT`, `EDITOR`, `VISUAL`, `PAGER`, `TERM`, `SHELL`, `LANG`, `LC_*`, `TZ`, `PATH`, `HOME`, `USER`, `LOGNAME`, `NIX_PATH`, `FLAKE`, `INPUTRC`, `LESS`, `MORE`, `PAGER`, `MANPATH`, `INFOPATH`, `LD_LIBRARY_PATH`, `DYLD_LIBRARY_PATH`, `PKG_CONFIG_PATH`, `CMAKE_PREFIX_PATH`, `NODE_PATH`, `PYTHONPATH`, `RUBYLIB`, `PERL5LIB`, `CLASSPATH`, `C_INCLUDE_PATH`, `CPLUS_INCLUDE_PATH`, `LIBRARY_PATH`, `FPATH`, `GOPATH`, `CARGO_HOME`, `RUSTUP_HOME`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, `KUBECONFIG`, `HELM_*`, `TERRAFORM_*`, `PULUMI_*`, `AWS_*`, `AZURE_*`, `GOOGLE_*`, `GCLOUD_*`, `SNOWFLAKE_*`, `DATADOG_*`, `NEW_RELIC_*`, `SENTRY_*`, `GITHUB_TOKEN`, `GITLAB_TOKEN`, `BITBUCKET_*`, `SLACK_*`, `JIRA_*`, `PAGERDUTY_*`

### Ant-only command allowlist (`src/tools/BashTool/readOnlyValidation.ts:1141-1212`)

Commands allowed for read-only auto-approval that external users don't get:

| Command | Description |
|---------|-------------|
| `gh api` | GitHub API read-only calls |
| `gh search` | GitHub search |
| `gh issue list` | List issues |
| `gh pr list` | List PRs |
| `gh pr view` | View PR |
| `gh release list` | List releases |
| `aki` | Internal Anthropic knowledge base search CLI |

### Classifier permissions

| Feature | File | Detail |
|---------|------|--------|
| `classifierPermissionsEnabled` setting | `src/tools/ConfigTool/supportedSettings.ts:134` | Ant-only config setting for AI-based bash permission classification |
| `deny` alias for `soft_deny` | `src/utils/settings/types.ts:990` | Backward-compat alias in auto mode classifier config |
| `deny` field merging | `src/utils/settings/settings.ts:965` | Ant `deny` entries merged into `soft_deny` |
| Overly-broad rules stripping | `src/main.tsx:1763` | Auto-removes `Bash(*)` / `PowerShell(*)` allow rules |
| Editable prefix UI | `src/components/permissions/BashPermissionRequest/bashToolUseOptions.tsx:115` | Ants with classifier permissions get editable prefix UI |

### Pre/Post tool hook timing (`src/services/tools/toolExecution.ts`)

| Line | Feature |
|------|---------|
| 874 | Inline timing summary when pre-tool hooks take >500ms |
| 1546 | Inline timing summary when post-tool hooks take >500ms |

### Permission analytics (extra for ants)

| Event | File | Detail |
|-------|------|--------|
| `tengu_internal_tool_use_permission_request_no_always_allow` | `src/components/permissions/hooks.ts:142` | When Bash tool has no "always allow" suggestions |
| `tengu_internal_bash_tool_use_permission_request` | `src/components/permissions/hooks.ts:169` | Detailed bash command logging with command parts |

## 10. OAuth & Authentication

| Feature | File | Detail |
|---------|------|--------|
| Staging OAuth config | `src/constants/oauth.ts:118-143` | API/Console/Claude.ai staging URLs (DCE'd from external) |
| `USE_LOCAL_OAUTH` / `USE_STAGING_OAUTH` env vars | `src/constants/oauth.ts:7` | Switch OAuth environments |
| API client staging baseURL | `src/services/api/client.ts:317` | Override from staging OAuth config |
| Different GrowthBook SDK keys | `src/constants/keys.ts:6` | Dev/prod keys vs public key `sdk-zAZezfDKGoZuXXKe` |
| Bridge token/URL overrides | `src/bridge/bridgeConfig.ts:20,29` | Via env vars for development |

## 11. IDE Integration

| Feature | File | Detail |
|---------|------|--------|
| VS Code extension ID | `src/utils/ide.ts:848` | `anthropic.claude-code-internal` (vs `anthropic.claude-code`) |
| Extension install source | `src/utils/ide.ts:884` | **Artifactory** (vs marketplace) |
| `file_updated` notifications | `src/services/mcp/vscodeSdkMcp.ts:44` | Only ants send file-updated notifications to VS Code MCP |
| MCP stdio command tracking | `src/services/mcp/useManageMCPConnections.ts:989,999` | Stdio command names collected and logged in analytics |

## 12. Telemetry & Analytics

### Extra event fields (ant-only)

| Field | Event / File | Detail |
|-------|-------------|--------|
| `agent_type` | `tengu_agent_memory_loaded` (`src/utils/systemPrompt.ts:88`) | Agent type in memory events |
| `agent_type` | In-process teammate events (`src/utils/swarm/inProcessRunner.ts:950`) | Agent type in swarm events |
| `suggestion`, `userInput` | Prompt suggestion events (`src/hooks/usePromptSuggestion.ts:151`) | Actual suggestion text and user input |
| `skill_name`, `skill_source`, `skill_loaded_from` | SkillTool events (`src/tools/SkillTool/SkillTool.ts:171,694,1051`) | Detailed skill invocation metadata |
| `thinking_output` | Beta session tracing (`src/utils/telemetry/betaSessionTracing.ts:431`) | Thinking blocks captured |
| `ant_enabled_names` | Plugin metrics (`src/hooks/useManagePlugins.ts:214`) | Enabled plugin names for correlation |
| `relativeProjectPath` | Startup telemetry (`src/main.tsx:4598`) | Relative project path |
| `stdio_commands` | MCP events (`src/services/mcp/useManageMCPConnections.ts:999`) | MCP server stdio commands |
| `tengu_web_fetch_host` | WebFetchTool (`src/tools/WebFetchTool/utils.ts:400`) | Fetched hostnames |
| `tengu_skill_descriptions_truncated` | SkillTool prompt (`src/tools/SkillTool/prompt.ts:125,149`) | Truncated skill descriptions |
| `tengu_extract_memories_gate_disabled` | Memory extraction (`src/services/extractMemories/extractMemories.ts:537`) | Gate failure logging |
| `tengu_sm_compact_flag_check` | Session memory compaction (`src/services/compact/sessionMemoryCompact.ts:423`) | Compaction flag checks |
| `tengu_sm_compact_error` | Session memory compaction (`src/services/compact/sessionMemoryCompact.ts:625`) | Compaction error logs |
| `tengu_internal_record_permission_context` | Internal logging (`src/services/internalLogging.ts:75`) | K8s namespace + container ID context |
| Rate limit reset event | Rate limit messages (`src/services/rateLimitMessages.ts:339`) | Feedback channel and `/reset-limits` suggestion |

### Always-sampled profiling

| Profiler | File | Detail |
|----------|------|--------|
| Startup profiler | `src/utils/startupProfiler.ts:33` | Always sampled (external: `Math.random() < STATSIG_SAMPLE_RATE`) |
| Headless profiler | `src/utils/headlessProfiler.ts:34` | Always sampled (external: random) |

### Prompt dumps (`src/services/api/dumpPrompts.ts`)

| Line | Feature |
|------|---------|
| 49 | API request data cached for `/share` debugging |
| 100 | Prompt dumps written to disk |
| 174 | API responses saved for debugging |

## 13. Setup & Config

| Feature | File | Detail |
|---------|------|--------|
| Repo classification primed | `src/setup.ts:338` | Pre-checks if repo is internal for undercover auto-detection |
| `--dangerously-skip-permissions` check | `src/setup.ts:419` | Extra safety checks about Docker/internet access |
| REPL mode default-on | `src/tools/REPLTool/constants.ts:23` | Default-on for ants in CLI; external needs `CLAUDE_REPL_MODE=1` |
| Shell tool defaults | `src/utils/shell/shellToolUtils.ts:19` | PowerShell default-on for ants on Windows (external: opt-in) |
| New init prompt | `src/commands/init.ts:231,247` | Enhanced init with skills/hooks docs (when combined with NEW_INIT feature) |
| Claude-in-Chrome | `src/main.tsx:1531` | Ants bypass subscriber check |
| User keybinding customization | `src/keybindings/loadUserBindings.ts:8` | `~/.claude/keybindings.json` only for ants |
| GrowthBook client key | `src/constants/keys.ts:6` | Different SDK key selection |
| Fennec-to-Opus migration | `src/migrations/migrateFennecToOpus.ts:19` | Renames internal "fennec" model aliases to "opus" in settings |
| PowerShell default | `src/utils/shell/shellToolUtils.ts:19` | PowerShell tool default-on for ant on Windows |
| Container ID detection | `src/services/internalLogging.ts:36` | OCI container ID detection |
| Kubernetes namespace detection | `src/services/internalLogging.ts:18` | K8s namespace detection |

## 14. Auto-Updater & Releases

| Feature | File | Detail |
|---------|------|--------|
| Separate max version cap | `src/utils/autoUpdater.ts:71` | Uses `ant` field in config (vs public field) |
| Separate blocking message | `src/utils/autoUpdater.ts:83` | Uses `ant_message` field |
| Version history (rollback) | `src/utils/autoUpdater.ts:383` | External always gets empty |
| Internal bundled changelog | `src/utils/releaseNotes.ts:292` | Uses `MACRO.VERSION_CHANGELOG` (external: fetch remote) |
| Bundled release notes | `src/utils/releaseNotes.ts:340` | Same pattern |
| Logo changelog | `src/utils/logoV2Utils.ts:314` | Bundled commits (vs stored changelog from memory) |
| Bundle name in errors | `src/cli/update.ts:297` | `@anthropic-ai/claude-cli` (vs `@anthropic-ai/claude-code`) |

## 15. System Prompt Differences

### Code style (`src/constants/prompts.ts:222-230`)

Ants get four additional instructions:
1. **Default to writing no comments** — only when WHY is non-obvious
2. **Don't explain WHAT code does** — well-named identifiers suffice
3. **Don't remove existing comments** — unless removing the described code
4. **Verify before reporting complete** — run tests, execute scripts, check output

### Assertiveness (`src/constants/prompts.ts:242-245`)

Ants get: "If you notice the user's request is based on a misconception, or spot a bug adjacent to what they asked about, say so."

### False-claims mitigation (`src/constants/prompts.ts:255-258`)

Ants get detailed instructions about faithful reporting: never claim passing tests when output shows failures, never suppress failing checks, never characterize broken work as done.

### Bug reporting guidance (`src/constants/prompts.ts:260-263`)

Ants get instructions recommending `/issue` or `/share`, and offering to post to `#claude-code-feedback` Slack channel.

### Output efficiency (`src/constants/prompts.ts:420-444`)

Ants get a comprehensive **"Communicating with the user"** section (12 lines) about writing for humans, flowing prose, inverted pyramid structure, etc.
External users get a short **"Output efficiency"** section: "Keep your text output brief and direct."

### Tone and style (`src/constants/prompts.ts:450-452`)

Ants skip the "Your responses should be short and concise" reminder.

### Numeric length anchors (`src/constants/prompts.ts:544-551`)

Ants get: "Keep text between tool calls to ≤25 words. Keep final responses to ≤100 words."

### FileEditTool uniqueness hint (`src/tools/FileEditTool/prompt.ts:17-19`)

Ants get: "Use the smallest unique `old_string`" in edit tool prompt.

### Plan mode prompt (`src/tools/EnterPlanModeTool/prompt.ts:166-169`)

Different prompts for ants vs external users.

## 16. UI Differences

| Component | File | Detail |
|-----------|------|--------|
| **DevBar** | `src/screens/REPL.tsx:4993` | Developer toolbar — entirely ant-only |
| **TungstenLiveMonitor** | `src/screens/REPL.tsx:4584` | tmux panel live monitor |
| **MemoryUsageIndicator** | `src/components/MemoryUsageIndicator.tsx:8` | Heap usage display — 10s polling interval never set up in external |
| **IssueFlagBanner** | `src/hooks/useIssueFlagBanner.ts:96` | Session friction detection + banner — entirely ant-only |
| **AntModelSwitchCallout** | `src/screens/REPL.tsx:221,4807` | Model switch UI overlay dialog |
| **UndercoverAutoCallout** | `src/screens/REPL.tsx:223,4817` | Undercover mode explainer dialog |
| **SkillImprovementSurvey** | `src/screens/REPL.tsx:4900` | Skill feedback survey |
| **Frustration detection** | `src/screens/REPL.tsx:107` | Real frustration detection (external: no-op) |
| **Ant org warning notification** | `src/screens/REPL.tsx:113` | Org-level warning notifications |
| **MoreRight feature** | `src/screens/REPL.tsx:604` | Via `CLAUDE_MORERIGHT` env var |
| **Plan verification** | `src/screens/REPL.tsx:3065` | Plan verification storage |
| **Tungsten panel visibility** | `src/state/onChangeAppState.ts:143` | Persisted to global config for sticky toggle |
| **Feedback command** | `src/screens/REPL.tsx:3598` | Ants see `/issue`, external see `/feedback` |
| **API metrics in spinner** | `src/components/Spinner.tsx:222` | API metrics in loading spinner |
| **Coordinator panel** | `src/components/PromptInput/PromptInputFooter.tsx:147,152` | Coordinator panel UI |
| **Tmux footer** | `src/components/PromptInput/PromptInput.tsx:297,298,394,458` | Tmux-related footer elements |

## 17. Tips Differences

| Tip | File | Effect |
|-----|------|--------|
| Plan mode tip | `src/services/tips/tipRegistry.ts:112` | **Hidden** for ants (they use different mode cycle) |
| Opus Plan Mode reminder | `src/services/tips/tipRegistry.ts:479` | **Hidden** for ants |
| Feedback command tip | `src/services/tips/tipRegistry.ts:627` | **Hidden** for ants (ants use `/issue`) |
| Shift-tab content | `src/services/tips/tipRegistry.ts:404` | Ants see "auto mode" in cycle; external see "auto-accept edit mode and plan mode" |
| **Internal-only tips** | `src/services/tips/tipRegistry.ts:636` | Ants get: "IMPORTANT: prefix for must-follow CLAUDE.md rules" and "Use /skillify at end of workflow" |

## 18. Infrastructure & Internal Tooling

| Feature | File | Detail |
|---------|------|--------|
| Event loop stall detector | `src/main.tsx:428` | Monitors main thread blocking >500ms |
| Terminal recording (asciicast) | `src/main.tsx:2223`, `src/utils/asciicast.ts:28` | Via `CLAUDE_CODE_TERMINAL_RECORDING=1` |
| SDK heap dump monitor | `src/main.tsx:2819` | Memory heap monitoring for SDK usage |
| Session data uploader | `src/main.tsx:3064` | Uploads session data to internal infra |
| CCShare resume | `src/main.tsx:3581` | Resume from internal share URLs |
| VCR force mode | `src/services/vcr.ts:28` | Via `FORCE_VCR` env var |
| Startup time benchmark | `src/hooks/useAfterFirstRender.ts:7` | Via `CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER` |
| S3 upload (insights) | `src/commands/insights.ts:3075` | Upload HTML report to internal S3 |
| Remote Coder workspace discovery | `src/commands/insights.ts:61-81` | SSH + SCP session data collection from remote hosts |
| LLM analysis: "CC team improvements" | `src/commands/insights.ts:1450` | Extra insight prompts in HTML report |
| LLM analysis: "Model behavior improvements" | `src/commands/insights.ts:1450` | Extra insight prompts in HTML report |
| Worktree dev panes | `src/utils/worktree.ts:1396` | Auto tmux watch + start panes in `claude-cli-internal` |
| ANTHROPIC npm cache cleanup | `src/utils/cleanup.ts:599` | Background cleanup of `@anthropic-ai/*` npm packages |
| OTEL env vars | `src/utils/telemetry/instrumentation.ts:88` | `ANT_OTEL_*` maps to standard OTEL exporter vars |
| BigQuery endpoint override | `src/utils/telemetry/bigqueryExporter.ts:50` | Via `ANT_CLAUDE_CODE_METRICS_ENDPOINT` |
| Prompt dumps to disk | `src/services/api/dumpPrompts.ts:100,174` | Request/response saved for debugging |
| Cross-project resume (worktree detection) | `src/utils/crossProjectResume.ts:42` | Ants get worktree-aware resume |

## 19. Miscellaneous Always-On Features

| Feature | File | Detail |
|---------|------|--------|
| Fast mode default-enabled | `src/utils/fastMode.ts:399,431,514` | Defaults to enabled on fetch failure, auth unknown, network error |
| `init` command enhanced | `src/commands/init.ts:231,247` | NEW_INIT prompt with skills/hooks docs |
| Agent memory loaded event | `src/utils/systemPrompt.ts:88` | `agent_type` field in events |
| Swarm agent memory events | `src/utils/swarm/inProcessRunner.ts:950` | `agent_type` field in swarm events |
| Skill analytics (rich) | `src/tools/SkillTool/SkillTool.ts:171,694,1051` | skill_name, skill_source, skill_loaded_from |
| Remote canonical skill resolution | `src/tools/SkillTool/SkillTool.ts:377,492,605` | Skills fetched from AKI/GCS |
| Task status migration | `src/utils/tasks.ts:320` | Temporary status migration |
| Email resolution via COO_CREATOR | `src/utils/user.ts:150,170` | Fallback env var for email |
| Fullscreen mode | `src/utils/fullscreen.ts:128` | Fullscreen terminal support |
| OSC terminal sequences | `src/ink/termio/osc.ts:468` | Terminal OSC sequence support |
| Sandbox properties display | `src/utils/status.tsx:29` | Sandbox properties in status |
| Native installer for ants | `src/utils/nativeInstaller/download.ts:141,509` | Ant-specific native install path |
| Hook name validation | `src/utils/hooks/hooksConfigManager.ts:346` | Ant hook name validation |
| Speculation time saved display | `src/components/Stats.tsx:515,1154` | Speculation metrics |
| Max version issue warning | `src/components/NativeAutoUpdater.tsx:109` | Max version warnings in UI |
| GitHub issues repo URL | `src/components/Feedback.tsx:35` | Different repo URL for ant |
| Changelog feed config | `src/components/LogoV2/feedConfigs.tsx:29,42,44` | Different changelog data source |
| Memory survey | `src/components/FeedbackSurvey/useMemorySurvey.tsx:90` | Memory feedback survey |
| Agent tool selector | `src/components/agents/ToolSelector.tsx:61` | Agent tool selection |
| Skill feedback hint | `src/components/messages/AttachmentMessage.tsx:116` | Skill feedback UI hint |
| Panel agent task handling | `src/components/tasks/taskStatusUtils.tsx:99` | Task panel handling |
| Message selector features | `src/components/MessageSelector.tsx:121` | Extra message selector capabilities |
| Todo V2 nag suppression | `src/utils/attachments.ts:3384` | Suppressed "use TaskUpdate instead" nag when BriefTool available |
| `tengu_worktree_cleanup` | `src/utils/cleanup.ts:599` | Cleanup of stale agent worktrees |
| `analyzeContext` details | `src/utils/analyzeContext.ts:415,1025,1354,1356,1358` | Extra context breakdown: deferred builtin details, system tool details, system prompt sections |

## 20. Planned / Commented-Out Gates

These exist in commented-out code with notes explaining that `USER_TYPE` checks must remain inlined for dead-code elimination:

| File | Lines | Context |
|------|-------|---------|
| `src/constants/prompts.ts` | 632-714 | DCE commentary: former undercover model description suppression. `process.env.USER_TYPE === 'ant'` *must* be inlined at each site — do not hoist to a const. |

---

> Last updated: July 2026. This covers **250+ gates** across **80+ files**.
