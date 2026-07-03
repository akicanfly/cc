import { defines } from './macros'

const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  target: 'bun',
  outdir: 'dist',
  define: defines,
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
