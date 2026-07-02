# Building Claude Code from Source

All source files, stub files, and config are already in place. Just build and run.

## Requirements

- Linux (Ubuntu 22.04+) or macOS — any arch (x86_64 or ARM64)
- [Bun](https://bun.sh) >= 1.3
- ripgrep (`apt install ripgrep` or equivalent)

## Build

```bash
bun install
bun build src/entrypoints/cli.tsx \
  --target=bun \
  --outdir=dist \
  --define 'MACRO.VERSION="1.0.34"' \
  --define 'MACRO.BUILD_TIMESTAMP="2026-03-31"' \
  --define 'MACRO.BUILD_TIME="2026-03-31T12:00:00Z"' \
  --define 'MACRO.FEEDBACK_CHANNEL="#claude-code-feedback"' \
  --define 'MACRO.ISSUES_EXPLAINER="https://github.com/anthropics/claude-code/issues"' \
  --define 'MACRO.NATIVE_PACKAGE_URL="@anthropic-ai/claude-code"' \
  --define 'MACRO.PACKAGE_URL="@anthropic-ai/claude-code"' \
  --define 'MACRO.VERSION_CHANGELOG=""'
mkdir -p dist/vendor/ripgrep/x64-linux
ln -sf $(which rg) dist/vendor/ripgrep/x64-linux/rg
```

Output: `dist/cli.js` (~24MB, ~5,000 modules).

## Run

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
bun run dist/cli.js
```

### Useful Flags

```
--version          Show version
--help             Show help
-p "Hello"         Pipe mode (print response and exit)
-d                 Debug mode
```

### Bypass Version Check

```bash
NODE_ENV=test bun run dist/cli.js
```

## Known Limitations

- No syntax-highlighted diffs (`color-diff-napi` is C++, replaced with stub)
- Feature flags disabled (voice mode, BRIDGE_MODE, PROACTIVE, etc.)
- Internal tools (Tungsten, REPL, SuggestBackgroundPR, VerifyPlanExecution) stubbed
- Sandboxing disabled
- Native modules stubbed

## Architecture

```
src/entrypoints/cli.tsx  -> Bootstrap, version check
  +-- src/main.tsx       -> Commander.js CLI
       +-- src/QueryEngine.ts  -> API calls, streaming, tool loop
       +-- src/tools.ts       -> Tool registry (Bash, Edit, Read, ...)
       +-- src/commands.ts    -> Slash commands
       +-- src/services/      -> API, MCP, OAuth, LSP
       +-- src/components/    -> React/Ink UI (~140 components)
       +-- src/hooks/         -> React hooks
       +-- src/bridge/        -> IDE integration
```
