# Building the `cc` Standalone Binary

The `build.ts` script bundles `src/entrypoints/cli.tsx` with `Bun.build`, and optionally compiles the result into a standalone binary with `bun build --compile`. The same script is used locally and in `.github/workflows/release.yml`.

## Quick Start

```
bun run build            # bundles dist/cli.js (~10.3 MB)
bun run build:compile    # also produces dist/bin/cc[.exe] (~20 MB)
```

`install:cc` chains both: `build:compile && scripts/install.ts`.

## Build Outputs

| Script | Output | Notes |
|---|---|---|
| `bun run build` | `dist/cli.js` | Bundled JS. Runs under Bun or Node. |
| `bun run build:compile` | `dist/bin/cc[.exe]` | Standalone binary with embedded Bun runtime. Cross-platform via `BUN_COMPILE_TARGET`. |

The compile step reads from `src/entrypoints/cli.tsx`, not `dist/cli.js` — re-bundling the already-bundled file would corrupt the pre-compiled React Compiler output in `src/*.tsx`.

## Flags

```
bun scripts/build.ts [options]

  --compile           Produce a standalone binary after the bundle step.
  --clean             (default) Remove dist/cli.js and dist/bin/ before building.
  --no-clean          Skip the clean step. Faster iteration; may leave orphan files.
```

`--clean` is the default. Pass `--no-clean` to keep existing build outputs.

## Environment Variables (compile step only)

| Variable | Purpose | Default |
|---|---|---|
| `BUN_COMPILE_TARGET` | Bun target triple, e.g. `bun-linux-x64`, `bun-darwin-arm64`, `bun-windows-x64` | `bun` (host arch) |
| `BUN_COMPILE_OUTFILE` | Output path for the binary | `dist/bin/cc[.exe]` |

## Build Macros

`scripts/macros.ts` exports `defines` — a `Record<string, string>` of compile-time string substitutions injected via `Bun.build`'s `define` option. Each value is a string literal with its own quotes baked in (define replacement is textual).

| Macro | Source | Used by |
|---|---|---|
| `MACRO.VERSION` | hardcoded | bridge, update flow, version command |
| `MACRO.BUILD_TIME` | `new Date().toISOString()` at module load | version display, analytics |
| `MACRO.FEEDBACK_CHANNEL` | hardcoded | error messages |
| `MACRO.ISSUES_EXPLAINER` | hardcoded | prompt strings |
| `MACRO.PACKAGE_URL` | hardcoded | npm-based update flow |
| `MACRO.NATIVE_PACKAGE_URL` | hardcoded | native-binary update flow (falls back to `PACKAGE_URL`) |
| `MACRO.VERSION_CHANGELOG` | hardcoded `""` (ant builds populate this) | release notes |

`MACRO.BUILD_TIME` is evaluated at module load, so the value reflects when the build actually ran — not a hardcoded date.

## Cross-Compilation

`release.yml` builds a matrix of targets from a single Linux runner. Locally, the same env vars work:

```
BUN_COMPILE_TARGET=bun-darwin-arm64 BUN_COMPILE_OUTFILE=dist/bin/cc-darwin-arm64 \
  bun run build:compile
```

The build script warns when the target's host doesn't match `process.platform`, so an accidental cross-compile (e.g. `BUN_COMPILE_TARGET=bun-windows-x64` on Linux) prints a clear message instead of silently producing a binary that won't run on the dev machine.

## Validation

The build script enforces three post-build checks:

1. **`Bun.build` success path**: any non-fatal warnings (level `warning`) are printed to stderr.
2. **Size sanity**: any output under 1 MB triggers a warning — a working bundle of `cli.tsx` is ~10 MB, so a 1 KB bundle means the build silently broke.
3. **Cross-compile target/host check**: warns when `BUN_COMPILE_TARGET`'s OS doesn't match the build host.

The compile step additionally wraps the `bun build --compile` spawn in `try/catch` (clean error if `bun` is not on `$PATH`) and prints a banner if the spawn exits non-zero.

## Release Workflow

`.github/workflows/release.yml` runs `bun run build` followed by `bun run build:compile` per matrix entry:

| Target | Outfile |
|---|---|
| `bun-linux-x64` | `dist/bin/cc-linux-x64` |
| `bun-linux-arm64` | `dist/bin/cc-linux-arm64` |
| `bun-linux-x64-musl` | `dist/bin/cc-linux-x64-musl` |
| `bun-linux-arm64-musl` | `dist/bin/cc-linux-arm64-musl` |
| `bun-windows-x64` | `dist/bin/cc-windows-x64.exe` |

Each binary is uploaded as a release artifact and bundled into a single GitHub release by the `release` job.

## Troubleshooting

**Build is slow / hangs** — `bun build --compile` downloads the target on first use; subsequent builds cache it. The default target has no download cost.

**`MACRO.BUILD_TIME` shows the wrong date** — the value is `new Date().toISOString()` evaluated when `macros.ts` is loaded. If the clock is wrong, fix the system clock; the macro will pick up the correct time on the next build.

**`--no-clean` left orphan files** — expected. Re-run without `--no-clean` (or just `bun run build`) to get a clean tree.

**Cross-compile produces a binary that won't run** — the script already warned. Either change `BUN_COMPILE_TARGET` to your host (`bun` for native), or test the binary on the matching platform.

## See Also

- `scripts/build.ts` — source.
- `scripts/macros.ts` — `defines` and the `ENTRYPOINT` constant.
- `scripts/install.ts` — copy the built binary to a directory on `PATH`.
- `docs/install.md` — install-side docs.
- `.github/workflows/release.yml` — production build matrix.
- `AGENTS.md` — project overview.
