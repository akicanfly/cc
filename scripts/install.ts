// Install the standalone `cc` binary into a writable directory on PATH.
//
// Usage:
//   bun scripts/install.ts [options]
//
// Options:
//   --target <dir>      Install to <dir>/cc[.exe] only. Overrides env-var candidates.
//   --outfile <path>    Source path. Overrides $BUN_COMPILE_OUTFILE.
//   --dry-run           Print resolved source/target and exit 0 without copying.
//   --uninstall         Remove the resolved target and exit.
//   --help              Print this message.
//
// Resolution order for the source: --outfile > $BUN_COMPILE_OUTFILE > dist/bin/cc[.exe].
// Resolution order for the target: --target > $CC_INSTALL_DIR > $HOME/.local/bin > $PREFIX/bin.

import {
  accessSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { join, resolve, dirname, basename, isAbsolute } from 'node:path'
import { spawn } from 'node:child_process'

// ---- CLI parsing -----------------------------------------------------------

const args = process.argv.slice(2)

function flag(name: string): boolean {
  return args.includes(name)
}

function value(name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0 || i + 1 >= args.length) return undefined
  return args[i + 1]
}

if (flag('--help') || flag('-h')) {
  console.log(`Install the standalone cc binary.

Usage: bun scripts/install.ts [options]

Options:
  --target <dir>      Install to <dir>/cc[.exe] only (overrides env candidates).
  --outfile <path>    Source path (overrides \$BUN_COMPILE_OUTFILE).
  --dry-run           Print plan and exit without copying.
  --uninstall         Remove the resolved target and exit.
  --help              Print this message.

Env vars:
  CC_INSTALL_DIR      First-preference install directory.
  BUN_COMPILE_OUTFILE Build output path (defaults to dist/bin/cc[.exe]).
  HOME                Used for ~/.local/bin fallback.
  PREFIX              Used for $PREFIX/bin fallback (Nix, Termux, etc).`)
  process.exit(0)
}

const dryRun = flag('--dry-run')
const uninstall = flag('--uninstall')
const targetOverride = value('--target')
const outfileOverride = value('--outfile')

if (dryRun && uninstall) {
  console.error('error: --dry-run and --uninstall are mutually exclusive')
  process.exit(2)
}

// ---- Source resolution ----------------------------------------------------

const isWindows = process.platform === 'win32'
const defaultName = isWindows ? 'cc.exe' : 'cc'

function defaultSourcePath(): string {
  return join(import.meta.dir, '..', 'dist', 'bin', defaultName)
}

const rawSource = outfileOverride ?? process.env.BUN_COMPILE_OUTFILE ?? defaultSourcePath()

// Resolve relative paths against the repo root (parent of scripts/) when they
// exist there, so the script works regardless of CWD. Fall back to CWD for
// intentional user-supplied relative paths.
const absoluteSource = (() => {
  if (isAbsolute(rawSource)) return rawSource
  const fromRepo = resolve(import.meta.dir, '..', rawSource)
  return existsSync(fromRepo) ? fromRepo : resolve(process.cwd(), rawSource)
})()

// ---- Source validation ----------------------------------------------------

function validateSource(path: string): { ok: true; size: number } | { ok: false; reason: string } {
  if (!existsSync(path)) {
    return { ok: false, reason: 'not found' }
  }
  let size: number
  try {
    size = statSync(path).size
  } catch (err) {
    return { ok: false, reason: `stat failed: ${(err as NodeJS.ErrnoException).message}` }
  }
  if (size < 1024) {
    return { ok: false, reason: `size ${size} bytes is suspiciously small (corrupt build?)` }
  }
  try {
    accessSync(path, 1 /* X_OK */)
  } catch {
    return { ok: false, reason: 'not executable (chmod +x and rebuild)' }
  }
  return { ok: true, size }
}

const sourceName = basename(absoluteSource)

if (uninstall) {
  // In uninstall mode the source is informational; we still want to refuse if
  // the user passed --outfile pointing at a tiny or non-executable file, but
  // we don't require the default build artifact to exist (the user may be
  // removing an older install from a wiped repo).
  if (outfileOverride || process.env.BUN_COMPILE_OUTFILE) {
    const v = validateSource(absoluteSource)
    if (!v.ok) {
      console.error(`error: source ${absoluteSource} ${v.reason}`)
      process.exit(1)
    }
  }
} else {
  const v = validateSource(absoluteSource)
  if (!v.ok) {
    console.error(`error: source ${absoluteSource} ${v.reason}`)
    console.error(`hint: run \`bun run build:compile\` first, or pass --outfile <path>.`)
    process.exit(1)
  }
}

// ---- Target resolution ----------------------------------------------------

function resolveHome(): string | undefined {
  // POSIX: $HOME. Windows: prefer $USERPROFILE; fall back to $HOMEDRIVE$HOMEPATH
  // (some minimal Windows envs only set the split vars). Bun does not
  // synthesize $HOME on Windows, so we can't rely on it being present.
  if (process.env.HOME) return process.env.HOME
  if (process.env.USERPROFILE) return process.env.USERPROFILE
  if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
    return process.env.HOMEDRIVE + process.env.HOMEPATH
  }
  return undefined
}

function buildCandidates(): string[] {
  if (targetOverride) return [targetOverride]
  const out: string[] = []
  if (process.env.CC_INSTALL_DIR) out.push(process.env.CC_INSTALL_DIR)
  const home = resolveHome()
  if (home) out.push(join(home, '.local', 'bin'))
  if (process.env.PREFIX) out.push(join(process.env.PREFIX, 'bin'))
  // Windows-specific candidate: per-user Programs dir, matching the layout
  // used by `npm install -g`, `winget`, and `scoop`. Falls back to
  // WindowsApps (the UWP-style bin that's always on PATH) when LOCALAPPDATA
  // is unset. These are appended after the POSIX-style candidates so the
  // override order remains predictable.
  if (isWindows) {
    if (process.env.LOCALAPPDATA) {
      out.push(join(process.env.LOCALAPPDATA, 'Programs', 'cc', 'bin'))
    }
    if (process.env.LOCALAPPDATA) {
      out.push(join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'))
    }
  }
  return out
}

const candidates = buildCandidates()

if (candidates.length === 0) {
  console.error('error: no install target resolved.')
  if (isWindows) {
    console.error('hint: pass --target <dir>, or set $CC_INSTALL_DIR, $USERPROFILE, or $LOCALAPPDATA.')
  } else {
    console.error('hint: pass --target <dir>, or set $CC_INSTALL_DIR, $HOME, or $PREFIX.')
  }
  process.exit(1)
}

// ---- Install / uninstall --------------------------------------------------

type AttemptError = { dir: string; message: string; code?: string }

function tryInstall(dir: string): { ok: true; target: string } | { ok: false; err: AttemptError } {
  let target: string
  try {
    target = join(dir, sourceName)
  } catch (err) {
    return { ok: false, err: { dir, message: (err as Error).message } }
  }
  const tmp = `${target}.tmp.${process.pid}`
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    return { ok: false, err: { dir, message: e.message, code: e.code } }
  }
  try {
    copyFileSync(absoluteSource, tmp)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    return { ok: false, err: { dir, message: `copyFileSync failed: ${e.message}`, code: e.code } }
  }
  try {
    renameSync(tmp, target)
  } catch (err) {
    // Clean up the orphan tmp file before bubbling the error.
    try { unlinkSync(tmp) } catch {}
    const e = err as NodeJS.ErrnoException
    return { ok: false, err: { dir, message: `rename failed: ${e.message}`, code: e.code } }
  }
  if (!isWindows) {
    try {
      chmodSync(target, 0o755)
    } catch (err) {
      // chmod failure after successful copy is non-fatal — the source may
      // already have the right mode. Warn and continue.
      console.warn(`warning: chmod 0o755 on ${target} failed: ${(err as Error).message}`)
    }
  }
  return { ok: true, target }
}

function tryUninstall(target: string): { ok: true } | { ok: false; err: AttemptError } {
  // Refuse to remove anything outside the candidate dirs we resolved — i.e.
  // we won't touch /usr/bin/cc or arbitrary user files. Also refuse if the
  // target's directory is not in our candidate list.
  const dir = dirname(target)
  if (!candidates.includes(dir) && !candidates.map(r => resolve(r)).includes(resolve(dir))) {
    return { ok: false, err: { dir, message: 'refusing to remove: directory not in candidate list' } }
  }
  if (!existsSync(target)) {
    return { ok: true } // already gone
  }
  // Size sanity check: don't remove a 0-byte file masquerading as our binary.
  try {
    const size = statSync(target).size
    if (size < 1024) {
      return { ok: false, err: { dir, message: `refusing to remove: target size ${size} bytes is suspiciously small` } }
    }
  } catch (err) {
    return { ok: false, err: { dir, message: (err as Error).message } }
  }
  try {
    unlinkSync(target)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    return { ok: false, err: { dir, message: `unlink failed: ${e.message}`, code: e.code } }
  }
  return { ok: true }
}

if (uninstall) {
  // Uninstall uses the *first* candidate as the target (matches install order).
  const target = join(candidates[0]!, sourceName)
  console.log(`Uninstall: ${target}`)
  if (dryRun) {
    console.log('(dry run: not removing)')
    process.exit(0)
  }
  const result = tryUninstall(target)
  if (!result.ok) {
    console.error(`error: ${result.err.message}`)
    process.exit(1)
  }
  console.log('Uninstalled.')
  process.exit(0)
}

// ---- Dry run --------------------------------------------------------------

if (dryRun) {
  console.log(`Source: ${absoluteSource}`)
  for (const dir of candidates) {
    console.log(`Would install to: ${join(dir, sourceName)}`)
  }
  console.log('(dry run: not copying)')
  process.exit(0)
}

// ---- Install loop ---------------------------------------------------------

let lastErr: AttemptError | null = null
let installedTarget: string | null = null
for (const dir of candidates) {
  const result = tryInstall(dir)
  if (result.ok) {
    installedTarget = result.target
    break
  }
  lastErr = result.err
  console.warn(`warning: ${dir}: ${result.err.message}${result.err.code ? ` (${result.err.code})` : ''}`)
}

if (!installedTarget) {
  console.error(`error: no install directory was writable. Tried: ${candidates.join(', ')}`)
  if (lastErr) console.error(`last error: ${lastErr.message}${lastErr.code ? ` (${lastErr.code})` : ''}`)
  process.exit(1)
}

console.log(`Installed ${absoluteSource} -> ${installedTarget}`)

// ---- macOS quarantine warning --------------------------------------------

if (process.platform === 'darwin') {
  try {
    const out = spawn('xattr', ['-l', installedTarget], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    out.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    out.on('close', (code) => {
      if (code === 0 && stdout.includes('com.apple.quarantine')) {
        console.warn(`warning: ${installedTarget} has a com.apple.quarantine xattr.`)
        console.warn(`  First run may be blocked by Gatekeeper. To fix:`)
        console.warn(`    xattr -d com.apple.quarantine ${installedTarget}`)
      }
    })
  } catch {
    // xattr not on PATH (rare) — silently skip.
  }
}

// ---- Smoke test -----------------------------------------------------------

function smokeTest(target: string): Promise<{ ok: boolean; exitCode: number | null; stdout: string; stderr: string; signal?: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let killed = false
    let proc: ReturnType<typeof spawn>
    try {
      proc = spawn(target, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ ok: false, exitCode: null, stdout, stderr: (err as Error).message })
      return
    }
    const timer = setTimeout(() => {
      killed = true
      try { proc.kill('SIGKILL') } catch {}
    }, 5000)
    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, exitCode: null, stdout, stderr: err.message })
    })
    proc.on('close', (code, signal) => {
      clearTimeout(timer)
      if (killed) {
        resolve({ ok: false, exitCode: code, stdout, stderr: stderr + '\n(smoke test timed out after 5s)', signal: 'SIGKILL' })
        return
      }
      resolve({ ok: code === 0, exitCode: code, stdout, stderr, signal: signal ?? undefined })
    })
  })
}

const smoke = await smokeTest(installedTarget)
if (!smoke.ok) {
  console.error(`error: smoke test failed (${installedTarget} --version)`)
  if (smoke.signal) console.error(`  signal: ${smoke.signal}`)
  if (smoke.stderr.trim()) console.error(`  stderr: ${smoke.stderr.trim()}`)
  if (smoke.stdout.trim()) console.error(`  stdout: ${smoke.stdout.trim()}`)
  console.error('The binary was installed but did not run successfully. Check the build output.')
  process.exit(1)
}
if (smoke.stdout.trim()) {
  console.log(`Smoke test OK: ${smoke.stdout.trim().split('\n')[0]}`)
} else {
  console.log('Smoke test OK.')
}

// ---- PATH / shadow warning -----------------------------------------------

function checkPathShadow(target: string): { onPath: boolean; targetDir: string } {
  const targetDir = dirname(target)
  const pathDirs = (process.env.PATH ?? '').split(isWindows ? ';' : ':').filter(Boolean)
  const onPath = pathDirs.some(d => resolve(d) === resolve(targetDir))
  if (onPath) {
    // Probe `which cc` / `where cc` to detect a different binary ahead of us.
    const probe = process.platform === 'win32' ? 'where' : 'which'
    try {
      const out = spawn(probe, [isWindows ? 'cc.exe' : 'cc'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let buf = ''
      out.stdout?.on('data', (chunk: Buffer) => { buf += chunk.toString() })
      out.on('close', () => {
        const found = buf.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        const conflict = found.find(p => resolve(p) !== resolve(target))
        if (conflict) {
          console.warn(`warning: \`cc\` on PATH resolves to ${conflict} (not ${target}).`)
          if (isWindows) {
            console.warn(`  Open a new terminal so the new \`cc.exe\` is picked up.`)
          } else {
            console.warn(`  Run \`hash -r\` (POSIX) or restart your shell to refresh the lookup cache.`)
          }
        } else if (found.length > 1) {
          console.warn(`warning: multiple \`cc\` entries on PATH: ${found.join(', ')}`)
        }
      })
    } catch {}
  }
  return { onPath, targetDir }
}

const pathInfo = checkPathShadow(installedTarget)
if (!pathInfo.onPath) {
  console.warn(`warning: ${pathInfo.targetDir} is not on $PATH.`)
  if (isWindows) {
    console.warn(`  Add it to your user PATH, e.g. (PowerShell):`)
    console.warn(`    [Environment]::SetEnvironmentVariable("Path", "${pathInfo.targetDir};" + $env:Path, "User")`)
    console.warn(`  Then open a new terminal for the change to take effect.`)
  } else {
    console.warn(`  Add it to your shell rc, e.g.:`)
    console.warn(`    export PATH="${pathInfo.targetDir}:$PATH"`)
  }
}
