# Installing the `cc` Standalone Binary

The `install:cc` script builds `dist/bin/cc[.exe]` and copies it to a writable directory on `PATH`. The build and install steps are split so you can run each independently.

## Quick Start

```
bun run install:cc
```

This chains `bun run build:compile` (produces the standalone binary) with `bun scripts/install.ts` (copies it to disk and smoke-tests it).

## Install Target Resolution

The installer tries the following directories in order and writes to the **first one that's writable**:

1. `--target <dir>` (CLI flag, overrides everything)
2. `$CC_INSTALL_DIR`
3. `$HOME/.local/bin`
4. `$PREFIX/bin`

A missing target directory is created with `mkdir -p`.

## Source Resolution

The source binary is resolved in this order:

1. `--outfile <path>` (CLI flag)
2. `$BUN_COMPILE_OUTFILE`
3. `dist/bin/cc[.exe]` relative to the repo root (`.exe` suffix on Windows)

Relative paths are resolved against the repo root when they exist there; otherwise against `cwd`. This means `bun scripts/install.ts` works the same regardless of where it's invoked from.

## What the Installer Does

For each candidate target directory:

1. `mkdir -p` the directory if it doesn't exist.
2. Copy the source to `<target>.tmp.<pid>`.
3. `rename` the temp file to `<target>` (atomic — no partial installs).
4. On POSIX: `chmod 755` the result.
5. On macOS: warn if `com.apple.quarantine` xattr is set.
6. Run `<target> --version` with a 5s timeout (smoke test).
7. Check whether the target directory is on `$PATH` and warn if not, or if `which cc` resolves elsewhere.

If every candidate fails, the script exits 1 with per-candidate error messages (no silent fall-through).

## CLI Flags

```
bun scripts/install.ts [options]

  --target <dir>      Install to <dir>/cc[.exe] only (overrides env candidates).
  --outfile <path>    Source path (overrides $BUN_COMPILE_OUTFILE).
  --dry-run           Print plan and exit without copying.
  --uninstall         Remove the resolved target and exit.
  --help              Print this message.
```

`--dry-run` and `--uninstall` are mutually exclusive.

## Uninstall

```
bun run uninstall:cc
```

Removes the binary from the first resolved target directory. The uninstall path refuses to delete:

- Files smaller than 1 KB (could be a coincidental filename, not our binary).
- Files outside the candidate directory list (won't touch `/usr/bin/cc` or arbitrary user files).

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `CC_INSTALL_DIR` | First-preference install directory | unset |
| `BUN_COMPILE_OUTFILE` | Build output path | `dist/bin/cc[.exe]` |
| `BUN_COMPILE_TARGET` | Compile target (e.g. `bun-linux-x64`) | `bun` (host arch) |
| `HOME` | Used for `~/.local/bin` fallback | unset |
| `PREFIX` | Used for `$PREFIX/bin` fallback (Nix, Termux) | unset |

## Build Outputs

| Script | Output | Notes |
|---|---|---|
| `bun run build` | `dist/cli.js` (~10.3 MB) | Bundled JS, runs under Bun or Node. |
| `bun run build:compile` | `dist/bin/cc[.exe]` (~20 MB) | Standalone binary with embedded Bun runtime. |
| `bun run install:cc` | Above + copy to install target | Build then install. |

## Cross-Platform Notes

- **Windows**: outfile gets `.exe` suffix automatically; the install target must end up on `%PATH%`. The `chmod` step is skipped.
- **macOS**: first run after install may be blocked by Gatekeeper if the binary carries a `com.apple.quarantine` xattr. The installer prints the `xattr -d com.apple.quarantine <path>` fix. Run it once to clear the attribute.
- **Termux / Nix / Guix**: set `PREFIX` to point at the right `bin/` (e.g. `/data/data/com.termux/files/usr` for Termux). If `HOME` resolves to a path that isn't actually on `PATH` (common in Termux), the installer prints a `hash -r` reminder.

## Troubleshooting

**"source not found"** — run `bun run build:compile` first, or pass `--outfile <path>` to point at an existing binary.

**"size N bytes is suspiciously small"** — the build output is truncated or zero-byte. Re-run the build.

**"not executable"** — the source lost its `+x` bit. `chmod +x` it, or rebuild.

**"smoke test failed"** — the binary installed but `cc --version` exited non-zero, hit a 5s timeout, or couldn't be spawned. Check the captured stdout/stderr the installer prints. The binary is left in place so you can debug.

**"`cc` on PATH resolves to a different path"** — the shell's command cache is stale. Run `hash -r` (POSIX) or open a new shell.

## See Also

- `scripts/install.ts` — source.
- `scripts/build.ts` — `Bun.build` and `bun build --compile` driver.
- `.github/workflows/release.yml` — the production reference; builds per-target matrix, uploads to release.
- `AGENTS.md` — project overview.
