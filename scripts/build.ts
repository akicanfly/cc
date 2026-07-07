import { defines } from './macros'

const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
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

for (const output of result.outputs) {
  const sizeInMb = output.size / 1024 / 1024
  console.log(`${output.path} ${sizeInMb.toFixed(2)} MB`)
}

// `bun run build -- --compile` produces a standalone `cc` binary.
// `BUN_COMPILE_TARGET` (e.g. `bun-linux-x64`) and `BUN_COMPILE_OUTFILE` (path)
// override the defaults. Compiles from the source entrypoint (not dist/cli.js) —
// re-bundling the already-bundled file corrupts the pre-compiled React Compiler
// output in src/*.tsx.
if (process.argv.includes('--compile')) {
  const target = process.env.BUN_COMPILE_TARGET ?? 'bun'
  const outfile = process.env.BUN_COMPILE_OUTFILE ?? 'dist/bin/cc'
  const defineArgs: string[] = []
  for (const [name, value] of Object.entries(defines)) {
    defineArgs.push('--define', `${name}=${value}`)
  }
  const compile = await Bun.spawn([
    'bun',
    'build',
    '--compile',
    `--target=${target}`,
    `--outfile=${outfile}`,
    './src/entrypoints/cli.tsx',
    ...defineArgs,
  ], { stdout: 'inherit', stderr: 'inherit' })
  process.exit(await compile.exited)
}
