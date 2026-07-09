import { rmSync, existsSync } from 'node:fs'
import { ENTRYPOINT, defines } from './macros'

// ---- CLI parsing -----------------------------------------------------------

const args = process.argv.slice(2)

function flag(name: string): boolean {
  return args.includes(name)
}

// Default to clean. --no-clean opts out. --clean is the explicit form.
const clean = !flag('--no-clean')

// ---- Clean step ------------------------------------------------------------

if (clean) {
  for (const p of ['dist/cli.js', 'dist/bin']) {
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true })
    }
  }
}

// ---- Bun.build (bundle) ----------------------------------------------------

const result = await Bun.build({
  entrypoints: [ENTRYPOINT],
  target: 'bun',
  outdir: 'dist',
  define: defines,
  minify: true,
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

// Surface non-fatal warnings the bundler emitted.
const warnings = result.logs.filter(l => l.level === 'warning')
for (const w of warnings) {
  console.warn(`warning: ${w.message ?? w}`)
}

// Sanity check: a working bundle should be at least 1 MB. A 1 KB bundle means
// something went silently wrong (empty entrypoint, broken define, etc).
const MIN_BUNDLE_BYTES = 1 * 1024 * 1024
for (const output of result.outputs) {
  if (output.size < MIN_BUNDLE_BYTES) {
    console.warn(`warning: ${output.path} is only ${output.size} bytes — bundle looks broken.`)
  }
  const sizeInMb = output.size / 1024 / 1024
  console.log(`${output.path} ${sizeInMb.toFixed(2)} MB`)
}

// ---- --compile: produce standalone `cc` binary -----------------------------
//
// `bun run build -- --compile` produces a standalone `cc` binary.
// `BUN_COMPILE_TARGET` (e.g. `bun-linux-x64`) and `BUN_COMPILE_OUTFILE` (path)
// override the defaults. Compiles from the source entrypoint (not dist/cli.js) —
// re-bundling the already-bundled file corrupts the pre-compiled React Compiler
// output in src/*.tsx.
if (args.includes('--compile')) {
  const target = process.env.BUN_COMPILE_TARGET ?? 'bun'
  const defaultExt = process.platform === 'win32' ? '.exe' : ''
  const defaultOutfile = `dist/bin/cc${defaultExt}`
  const outfile = process.env.BUN_COMPILE_OUTFILE ?? defaultOutfile

  // Warn if the target's host part doesn't match this machine. Cross-compile
  // is fine (release.yml does it from Linux), but a local dev who sets
  // BUN_COMPILE_TARGET=bun-windows-x64 by accident gets an unrunnable binary
  // and no signal that they did the wrong thing.
  if (target !== 'bun') {
    const m = /^bun-([a-z]+)-/.exec(target)
    const targetOs = m?.[1]
    if (targetOs && targetOs !== process.platform) {
      console.warn(`warning: BUN_COMPILE_TARGET=${target} targets ${targetOs}, but this host is ${process.platform}.`)
      console.warn(`         The resulting binary will not run here. Use --target=bun for a native build.`)
    }
  }

  const defineArgs: string[] = []
  for (const [name, value] of Object.entries(defines)) {
    defineArgs.push('--define', `${name}=${value}`)
  }
  let compile
  try {
    compile = Bun.spawn([
      'bun',
      'build',
      '--compile',
      `--target=${target}`,
      `--outfile=${outfile}`,
      ENTRYPOINT,
      ...defineArgs,
    ], { stdout: 'inherit', stderr: 'inherit' })
  } catch (err) {
    console.error(`error: failed to spawn \`bun build --compile\`: ${(err as Error).message}`)
    console.error('hint: is `bun` on your $PATH?')
    process.exit(1)
  }
  const exitCode = await compile.exited
  if (exitCode !== 0) {
    console.error(`error: \`bun build --compile\` exited with code ${exitCode}`)
  }
  process.exit(exitCode)
}
